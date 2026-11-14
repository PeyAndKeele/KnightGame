#!/usr/bin/env python3
"""Bakes a Blockbench glTF into the game's "ruins-data" format.

    python3 scripts/bake-gltf.py tomb.gltf tomb-data.json --center 0.015 0 -0.039
    python3 scripts/bake-gltf.py tombentry.gltf tombentry-data.json --center 0 0 0 --skip "GROUND HERE"

What it does (the same thing ruins-data.json is):
  * walks the node tree and applies every node's transform, so all vertices are in world space;
  * merges every mesh that uses the same material into ONE part;
  * writes  { "c": [x, y, z], "tex": [png data-urls], "parts": [{ t, p, n, uv, i, nocam? }] }
      c     the point of the model that lands under the knight's circle (--center), in the file's units
      tex   the images, as data: urls (parts index into this list with t; t = -1 means "no texture, plain grey")
      p/n/uv/i   positions, normals, uvs and triangle indices as flat lists
      nocam   1 on parts whose material name is listed with --nocam (the camera ignores them)

Options:
  --skip NAME    leave out every node with this name (Blockbench helper boxes such as "GROUND HERE"); repeatable
  --nocam NAME   flag the parts made of nodes with this name; repeatable
"""
import argparse
import base64
import json
import math

import numpy as np

COMP = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def accessor(g, buf, i):
    a = g["accessors"][i]
    bv = g["bufferViews"][a["bufferView"]]
    n = NCOMP[a["type"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    arr = np.frombuffer(buf, dtype=COMP[a["componentType"]], count=a["count"] * n, offset=off)
    return arr.reshape(a["count"], n)


def node_matrix(n):
    x, y, z, w = n.get("rotation", [0, 0, 0, 1])
    t = n.get("translation", [0, 0, 0])
    s = n.get("scale", [1, 1, 1])
    r = np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )
    m = np.eye(4)
    m[:3, :3] = r * np.array(s)
    m[:3, 3] = t
    return m


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--center", nargs=3, type=float, default=[0, 0, 0])
    ap.add_argument("--skip", action="append", default=[])
    ap.add_argument("--nocam", action="append", default=[])
    a = ap.parse_args()

    g = json.load(open(a.src))
    buf = base64.b64decode(g["buffers"][0]["uri"].split(",", 1)[1])

    # images -> data urls; textures -> image index; materials -> which image (or -1)
    tex = [im["uri"] for im in g.get("images", [])]
    tex_img = [t["source"] for t in g.get("textures", [])]

    def mat_image(mi):
        if mi is None:
            return -1
        bc = g["materials"][mi]["pbrMetallicRoughness"].get("baseColorTexture")
        return tex_img[bc["index"]] if bc else -1

    merged = {}  # (image index, nocam) -> lists

    def visit(i, parent, under_nocam):
        n = g["nodes"][i]
        if n.get("name") in a.skip:
            return
        m = parent @ node_matrix(n)
        nocam = under_nocam or n.get("name") in a.nocam
        if "mesh" in n:
            rot = np.linalg.inv(m[:3, :3]).T  # normals
            for pr in g["meshes"][n["mesh"]]["primitives"]:
                at = pr["attributes"]
                pos = accessor(g, buf, at["POSITION"]).astype(np.float64)
                nor = accessor(g, buf, at["NORMAL"]).astype(np.float64)
                uv = accessor(g, buf, at["TEXCOORD_0"]).astype(np.float64) if "TEXCOORD_0" in at else np.zeros((len(pos), 2))
                idx = accessor(g, buf, pr["indices"]).reshape(-1).astype(np.int64)
                wp = (m[:3, :3] @ pos.T).T + m[:3, 3]
                wn = (rot @ nor.T).T
                wn /= np.maximum(np.linalg.norm(wn, axis=1, keepdims=True), 1e-9)
                key = (mat_image(pr.get("material")), bool(nocam))
                d = merged.setdefault(key, {"p": [], "n": [], "uv": [], "i": [], "base": 0})
                d["p"].append(wp)
                d["n"].append(wn)
                d["uv"].append(uv)
                d["i"].append(idx + d["base"])
                d["base"] += len(pos)
        for c in n.get("children", []):
            visit(c, m, nocam)

    for r in g["scenes"][g.get("scene", 0)]["nodes"]:
        visit(r, np.eye(4), False)

    def flat(arrs, digits):
        a_ = np.round(np.concatenate(arrs).reshape(-1), digits)
        return [int(v) if float(v).is_integer() else float(v) for v in a_]

    parts = []
    for (img, nocam), d in sorted(merged.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        part = {
            "t": img,
            "p": flat(d["p"], 4),
            "n": flat(d["n"], 3),
            "uv": flat(d["uv"], 5),
            "i": [int(v) for v in np.concatenate(d["i"])],
        }
        if nocam:
            part["nocam"] = 1
        parts.append(part)

    out = {"c": a.center, "parts": parts, "tex": tex}
    with open(a.dst, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    allp = np.concatenate([np.array(p["p"]).reshape(-1, 3) for p in parts])
    print(
        f"{a.dst}: {len(parts)} parts, {sum(len(p['i']) // 3 for p in parts)} triangles, "
        f"{len(tex)} textures; bbox {np.round(allp.min(0), 3)} .. {np.round(allp.max(0), 3)}"
    )


if __name__ == "__main__":
    main()
