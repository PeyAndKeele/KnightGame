#!/usr/bin/env python3
"""Bakes a Blockbench glTF weapon into the game's weapon-model format (like shovel-data.json).

    python3 scripts/bake-weapon.py halberd.gltf halberd-data.json
    python3 scripts/bake-weapon.py reaver.gltf reaver-data.json --plume-node "PUT THE SAME PLUME"

Output: { "parts": [ { name, t, r, p, n, uv, i, tex, plume? } ] }
  * every node's transform (including parents') is applied, so p / n are final: t and r are always [0,0,0];
  * meshes that use the same material are merged into ONE part (one texture each);
  * tex is the material's image as a data: url. A material with no image is given a plain 16x16 colour (its baseColorFactor, or the gem red).
Options:
  --plume-node TEXT   a node whose name starts with TEXT is the weapon's GEM: its part gets "plume": 1, which makes the game
                      colour it with the plume picker and make it glow (see plumeGem in js/04-weapons.js, and the Wretched Cleaver)
  --skip NAME         leave out every node with this name (repeatable)
Check the result by adding it to manifest.json and to AXE_STYLE_MODELS (heavy) or an init function (light) in js/04-weapons.js.
"""
import argparse
import base64
import io
import json

import numpy as np
from PIL import Image

COMP = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
GEM_RGBA = (230, 68, 68, 255)  # the Wretched Cleaver's gem red


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


def data_url_bytes(uri):
    return base64.b64decode(uri.split(",", 1)[1])


def png_url(rgba):
    im = Image.new("RGBA", (16, 16), rgba)
    b = io.BytesIO()
    im.save(b, "PNG")
    return "data:image/png;base64," + base64.b64encode(b.getvalue()).decode()


def r5(a):
    return [round(float(v), 5) for v in np.asarray(a).ravel()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--plume-node", default=None)
    ap.add_argument("--skip", action="append", default=[])
    a = ap.parse_args()
    g = json.load(open(a.src))
    buf = data_url_bytes(g["buffers"][0]["uri"])
    parts = {}  # material index -> merged geometry

    def walk(ni, parent_m, gem_parent):
        n = g["nodes"][ni]
        if n.get("name") in a.skip:
            return
        m = parent_m @ node_matrix(n)
        gem = gem_parent or bool(a.plume_node and n.get("name", "").startswith(a.plume_node))
        if "mesh" in n:
            nm = np.linalg.inv(m[:3, :3]).T
            for pr in g["meshes"][n["mesh"]]["primitives"]:
                at = pr["attributes"]
                pos = accessor(g, buf, at["POSITION"]).astype(np.float64)
                nor = accessor(g, buf, at["NORMAL"]).astype(np.float64)
                uv = accessor(g, buf, at["TEXCOORD_0"]).astype(np.float64)
                idx = accessor(g, buf, pr["indices"]).ravel().astype(np.int64)
                wp = pos @ m[:3, :3].T + m[:3, 3]
                wn = nor @ nm.T
                wn /= np.maximum(np.linalg.norm(wn, axis=1, keepdims=True), 1e-9)
                key = (pr.get("material"), gem)
                P = parts.setdefault(key, {"p": [], "n": [], "uv": [], "i": [], "base": 0})
                P["p"].append(wp)
                P["n"].append(wn)
                P["uv"].append(uv)
                P["i"].append(idx + P["base"])
                P["base"] += len(pos)
        for c in n.get("children", []):
            walk(c, m, gem)

    for ni in g["scenes"][0]["nodes"]:
        walk(ni, np.eye(4), False)

    out = []
    for k, ((mat, gem), P) in enumerate(parts.items()):
        tex = None
        mm = g["materials"][mat] if mat is not None else {}
        bct = mm.get("pbrMetallicRoughness", {}).get("baseColorTexture")
        if bct is not None and not gem:
            img = g["images"][g["textures"][bct["index"]]["source"]]
            tex = "data:image/png;base64," + base64.b64encode(data_url_bytes(img["uri"])).decode()
        else:
            f = mm.get("pbrMetallicRoughness", {}).get("baseColorFactor")
            rgba = GEM_RGBA if (gem or not f) else tuple(int(round(c * 255)) for c in f)
            tex = png_url(rgba)
        part = {
            "name": ("gem" if gem else "p%d" % k),
            "t": [0, 0, 0],
            "r": [0, 0, 0],
            "p": r5(np.concatenate(P["p"])),
            "n": r5(np.concatenate(P["n"])),
            "uv": r5(np.concatenate(P["uv"])),
            "i": [int(v) for v in np.concatenate(P["i"])],
            "tex": tex,
        }
        if gem:
            part["plume"] = 1
        out.append(part)
    json.dump({"parts": out}, open(a.dst, "w"), separators=(",", ":"))
    allp = np.concatenate([np.array(p["p"]).reshape(-1, 3) for p in out])
    print(a.dst, "%d parts, %d triangles, y %.3f..%.3f, x %.3f..%.3f, z %.3f..%.3f" % (
        len(out), sum(len(p["i"]) for p in out) // 3, allp[:, 1].min(), allp[:, 1].max(),
        allp[:, 0].min(), allp[:, 0].max(), allp[:, 2].min(), allp[:, 2].max()))


main()
