#!/usr/bin/env python3
# Matcher di ispezione: confronto pixel ESATTO tra lo snapshot del canvas
# del gioco e gli sprite REALI del registro (nessuna inferenza: posizioni e
# scale sono MISURATE, non dedotte; gli elementi non trovati non vengono
# mostrati). Dati originali: registry.json (GameMaker, variabile _M) e
# file png+xml (FNF Sparrow).
#
# Pipeline per template:
#   1. scala 1:1 (pre-match a mappa 1/2 + raffinamento 1:1)
#   2. scale fisso (2.0 per piccoli; griglia per ricerca mirata)
#   3. se irrisolto: scansione di scala su mappa 1/4 → raffinamento scala su
#      mappa 1/2 → conferma a scala piena
#   4. percorso occlusione: verifica a tile (misura la parte visibile di un
#      elemento parzialmente coperto da altri disegni)
#
# stdin:  {"gameDir": "...", "image": "data:image/png;base64,...", "only": [...]}
# stdout: {"matches": [...], "stats": {...}}

import sys, json, base64, os, re, time, hashlib
import numpy as np
import cv2

THR_FULL = 0.96          # soglia conferma a scala piena
THR_SCALED = 0.92        # soglia per scale != 1 (risampleazione: punteggio riportato)
THR_COARSE = 0.90        # soglia pre-match a scala 1/2
THR_TILE = 0.88          # correlazione minima per singolo tile
TILE_FRAC_MIN = 0.60     # frazione di tile coerenti per accettare un match occluso
SWEEP_MIN = 0.62         # candidato minimo della scansione di scala (mappa 1/4)
SWEEP_MIN2 = 0.72        # i candidati oltre il primo devono essere più solidi
HALF_MIN = 0.62          # candidato minimo dopo raffinamento scala (mappa 1/2)
MIN_TPL = 5
MIN_COARSE = 8           # sotto: solo match diretto a scala piena
MIN_OCCLUDED = 24        # dimensione minima per scansione di scala e tile
CLUSTER_DIST = 6
MAX_MATCHES = 600
SCALES_SMALL = (1.0, 2.0)
SCALES_OVERSIZED = (0.5, 0.33, 0.25)
SCALES_TARGETED = (0.25, 0.33, 0.5, 0.66, 0.75, 0.9, 1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0)

def decode_snapshot(data_url):
    m = re.match(r"^data:image/(png|jpeg);base64,(.*)$", data_url, re.S)
    if not m:
        raise ValueError("dataURL immagine non valido")
    buf = np.frombuffer(base64.b64decode(m.group(2)), dtype=np.uint8)
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("snapshot non decodificabile")
    return img

def nms(points, dist=CLUSTER_DIST):
    kept = []
    for x, y, s in sorted(points, key=lambda p: -p[2]):
        ok = True
        for kx, ky, _ in kept:
            if (x - kx) ** 2 + (y - ky) ** 2 <= dist * dist:
                ok = False
                break
        if ok:
            kept.append((x, y, s))
    return kept

def peaks(res, thr):
    """solo massimi locali sopra soglia."""
    dil = cv2.dilate(res, np.ones((3, 3), np.uint8))
    mask = (res >= thr) & (res == dil)
    ys, xs = np.where(mask)
    return list(zip(xs.tolist(), ys.tolist(), res[ys, xs].tolist()))

def safe_match(roi, tpl):
    """matchTemplate protetto: dimensioni e dtype verificati, errori assorbiti."""
    if roi is None or tpl is None:
        return None
    if roi.ndim != tpl.ndim or roi.shape[0] < tpl.shape[0] or roi.shape[1] < tpl.shape[1]:
        return None
    if roi.dtype != np.uint8 or tpl.dtype != np.uint8:
        return None
    try:
        return cv2.matchTemplate(roi, tpl, cv2.TM_CCOEFF_NORMED)
    except cv2.error:
        return None

def raw_match(snap_gray, tpl_gray, thr, with_best=False):
    th, tw = tpl_gray.shape[:2]
    ok = th >= MIN_TPL and tw >= MIN_TPL and th <= snap_gray.shape[0] and tw <= snap_gray.shape[1]
    if not ok or float(tpl_gray.std()) < 2.0:
        return ([], None) if with_best else []
    res = safe_match(snap_gray, tpl_gray)
    if res is None:
        return ([], None) if with_best else []
    pts = [(int(x), int(y), float(s)) for x, y, s in peaks(res, thr)]
    if not with_best:
        return nms(pts)
    _, mx, _, loc = cv2.minMaxLoc(res)
    return nms(pts), (int(loc[0]), int(loc[1]), float(mx))

def refine(snap_gray, tpl, x, y, pad=6):
    """raffina una posizione su una ROI attorno a (x, y)."""
    th, tw = tpl.shape[:2]
    sh, sw = snap_gray.shape
    if th > sh or tw > sw:
        return None
    x0 = max(0, x - pad); y0 = max(0, y - pad)
    x1 = min(sw, x + tw + pad); y1 = min(sh, y + th + pad)
    if x1 - x0 < tw or y1 - y0 < th:
        return None
    res = safe_match(snap_gray[y0:y1, x0:x1], tpl)
    if res is None:
        return None
    _, score, _, loc = cv2.minMaxLoc(res)
    return (x0 + loc[0], y0 + loc[1], float(score))

def tile_score(snap_gray, tpl, x, y):
    """frazione di tile coerenti: parte VISIBILE di un elemento coperto."""
    th, tw = tpl.shape[:2]
    tile = max(12, min(tw, th) // 6)
    good = total = 0
    for yy in range(0, th - tile + 1, tile):
        for xx in range(0, tw - tile + 1, tile):
            t = tpl[yy:yy + tile, xx:xx + tile].astype(np.float32)
            r = snap_gray[y + yy:y + yy + tile, x + xx:x + xx + tile].astype(np.float32)
            if t.shape != r.shape or t.std() < 3:
                continue
            total += 1
            a = t - t.mean(); b = r - r.mean()
            d = np.sqrt(float((a * a).sum()) * float((b * b).sum()))
            if d <= 0:
                continue
            if float((a * b).sum()) / d >= THR_TILE:
                good += 1
    return good / max(1, total)

def tpl_at(tpl_gray, scale, tw, th):
    if scale == 1.0:
        return tpl_gray
    interp = cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC
    return cv2.resize(tpl_gray, (tw, th), interpolation=interp)

class Matcher:
    """snapshot pre-scalati: 1/2 per il pre-match, 1/4 per la scansione di scala."""

    def __init__(self, snap_gray):
        self.snap = snap_gray
        self.snap_half = cv2.resize(snap_gray, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)
        self.snap_quarter = cv2.resize(snap_gray, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)

    def hits_at_scale(self, tpl_gray, scale):
        """[(x, y, score, w, h, occluded, scale)] — percorso coarse+refine."""
        sh, sw = self.snap.shape
        tw = int(round(tpl_gray.shape[1] * scale))
        th = int(round(tpl_gray.shape[0] * scale))
        if tw < MIN_TPL or th < MIN_TPL or tw > sw or th > sh:
            return []
        tpl = tpl_at(tpl_gray, scale, tw, th)
        if float(tpl.std()) < 2.0:
            return []
        thr = THR_FULL if scale == 1.0 else THR_SCALED
        if min(tw, th) >= MIN_COARSE:
            ts = cv2.resize(tpl, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)
            if ts.shape[0] < MIN_TPL or ts.shape[1] < MIN_TPL:
                return [(x, y, s, tw, th, False, scale) for x, y, s in raw_match(self.snap, tpl, thr)]
            out = []
            for cx, cy, _ in raw_match(self.snap_half, ts, THR_COARSE):
                r = refine(self.snap, tpl, cx * 2, cy * 2)
                if r and r[2] >= thr:
                    out.append((r[0], r[1], r[2], tw, th, False, scale))
            return out
        return [(x, y, s, tw, th, False, scale) for x, y, s in raw_match(self.snap, tpl, thr)]

    def occluded_hit(self, tpl_gray, scale):
        """[non usato: la scansione di scala copre l'occlusione]"""
        return None

    def sweep_scale(self, tpl_gray):
        """scansione di scala su mappa 1/4: [(score, scale, x4, y4)] ordinate.
        Range adattivo: sprite piccoli (pixel art) fino a ×3, gli altri ×2."""
        sh, sw = self.snap_quarter.shape
        s_max = 3.0 if min(tpl_gray.shape[:2]) <= 48 else 2.0
        out = []
        s = 0.5
        while s <= s_max + 1e-9:
            tw = int(round(tpl_gray.shape[1] * s / 4))
            th = int(round(tpl_gray.shape[0] * s / 4))
            if 4 <= tw <= sw and 4 <= th <= sh:
                t = cv2.resize(tpl_gray, (tw, th), interpolation=cv2.INTER_AREA)
                if float(t.std()) >= 2.0:
                    res = safe_match(self.snap_quarter, t)
                    if res is not None:
                        _, mx, _, loc = cv2.minMaxLoc(res)
                        out.append((float(mx), round(s, 2), loc[0], loc[1]))
            s += 0.2
        out.sort(key=lambda b: -b[0])
        return out

    def refine_scale_half(self, tpl_gray, s0, x4, y4):
        """affina la scala attorno a s0 sulla mappa 1/2, attorno a (x4, y4).
        Prima la scala centrale: se è pessima il candidato viene scartato
        subito (1 confronto invece di 5 per i candidati spazzatura)."""
        sh, sw = self.snap_half.shape

        def eval_s(s):
            tw = int(round(tpl_gray.shape[1] * s / 2))
            th = int(round(tpl_gray.shape[0] * s / 2))
            if tw < MIN_TPL or th < MIN_TPL or tw > sw or th > sh:
                return None
            t = tpl_at(tpl_gray, s, tw, th)
            win = int(max(16, tw * 0.2))
            cx, cy = x4 * 2, y4 * 2
            x0 = max(0, cx - win); y0 = max(0, cy - win)
            x1 = min(sw, cx + tw + win); y1 = min(sh, cy + th + win)
            if x1 - x0 < tw or y1 - y0 < th:
                return None
            res = safe_match(self.snap_half[y0:y1, x0:x1], t)
            if res is None:
                return None
            _, mx, _, loc = cv2.minMaxLoc(res)
            return (float(mx), round(s, 2), x0 + loc[0], y0 + loc[1])

        c = eval_s(s0)
        if not c or c[0] < 0.5:
            return None
        best = c
        for ds in (-0.06, 0.06, -0.12, 0.12):
            r = eval_s(s0 + ds)
            if r and r[0] > best[0]:
                best = r
            if best[0] >= 0.75:
                break
        return best

# The serverless function has a limited memory budget. Build only a bounded,
# preselected set of templates; never decode every PNG/animation in the game.
MAX_TEMPLATES = 24
MAX_CROP_AREA = 360000

def build_templates_gm(game_dir, only=None):
    """GameMaker: extract only a small number of frames from the original atlas."""
    reg = json.load(open(os.path.join(game_dir, "registry.json"), encoding="utf-8"))
    candidates = list(reg.get("sprites", []))
    if only:
        candidates = [s for s in candidates
                      if f"sprite:{s['name']}" in only or s["name"] in only]
    else:
        keywords = re.compile(r"title|logo|menu|bg|button|press|start|play|dancer|icon", re.I)
        candidates.sort(key=lambda s: (not bool(keywords.search(s["name"])), s["index"]))
        candidates = candidates[:18]
    used_pages = {f["page"] for s in candidates for f in s.get("frames", [])[:3]}
    pages = {}
    for t in reg.get("textures", []):
        if t["index"] not in used_pages:
            continue
        p = os.path.join(game_dir, t["file"])
        if os.path.exists(p):
            pages[t["index"]] = cv2.imread(p, cv2.IMREAD_GRAYSCALE)
    out = []
    for s in candidates:
        for fi, f in enumerate(s.get("frames", [])[:3]):
            page = pages.get(f["page"])
            if page is None:
                continue
            x, y, w, h = (int(f[k]) for k in ("x", "y", "w", "h"))
            if w < MIN_TPL or h < MIN_TPL or w * h > MAX_CROP_AREA:
                continue
            if y + h > page.shape[0] or x + w > page.shape[1]:
                continue
            out.append({
                "id": f"sprite:{s['name']}",
                "name": s["name"] if s.get("frameCount", 1) == 1 else f"{s['name']}[{fi}]",
                "gray": page[y:y+h, x:x+w].copy(),
                "w": w, "h": h,
                "meta": {"page": f["page"], "ax": x, "ay": y},
            })
            if len(out) >= MAX_TEMPLATES:
                return out
    return out


def build_templates_fnf(game_dir, only=None):
    """OpenFL: limit PNGs before decoding and sample a few Sparrow atlas frames."""
    reg = json.load(open(os.path.join(game_dir, "registry.json"), encoding="utf-8"))
    files = [f for f in reg.get("files", []) if f.get("type") == "png"]
    if only:
        files = [f for f in files if f"file:{f['path']}" in only
                 or f["path"] in only]
    else:
        # Best-effort first-screen/menu/gameplay samples, NOT exhaustive.
        preferred = ("logoBumpin.png", "gfDanceTitle.png", "titleEnter.png",
                     "FNF_main_menu_assets.png", "menuBG.png", "menuBGBlue.png",
                     "NOTE_assets.png", "BOYFRIEND.png", "GF_assets.png")
        files = [f for f in files if any(f["path"].endswith(p) for p in preferred)]
    out = []
    for f in files[:8]:
        p = os.path.join(game_dir, f["path"])
        if not os.path.isfile(p):
            continue
        img = cv2.imread(p, cv2.IMREAD_GRAYSCALE)
        if img is None:
            continue
        xml_path = p[:-4] + ".xml"
        if os.path.exists(xml_path):
            xml = open(xml_path, encoding="utf-8", errors="replace").read()
            frames = list(re.finditer(
                r'<SubTexture[^>]*name="([^"]+)"[^>]*?x="(\d+)"[^>]*?y="(\d+)"'
                r'[^>]*?width="(\d+)"[^>]*?height="(\d+)"', xml))
            # Sample across the animation instead of retaining hundreds of frames.
            stride = max(1, len(frames) // 4)
            for m in frames[::stride][:4]:
                name, sx, sy, sw, sh = (m.group(1), int(m.group(2)),
                                         int(m.group(3)), int(m.group(4)), int(m.group(5)))
                if sw < MIN_TPL or sh < MIN_TPL or sw * sh > MAX_CROP_AREA:
                    continue
                if sy + sh > img.shape[0] or sx + sw > img.shape[1]:
                    continue
                out.append({
                    "id": f"file:{f['path']}",
                    "name": f"{os.path.basename(f['path'])}@{name}",
                    "gray": img[sy:sy + sh, sx:sx + sw].copy(),
                    "w": sw, "h": sh, "meta": {"rect": [sx, sy]},
                })
        elif img.shape[0] >= MIN_TPL and img.shape[1] >= MIN_TPL \
                and img.shape[0] * img.shape[1] <= MAX_CROP_AREA:
            out.append({
                "id": f"file:{f['path']}",
                "name": os.path.basename(f["path"]),
                "gray": img.copy(), "w": img.shape[1], "h": img.shape[0],
                "meta": {},
            })
        if len(out) >= MAX_TEMPLATES:
            break
    return out[:MAX_TEMPLATES]


def analyze(req):
    """Reusable sprite matching operation called by the native Python API."""
    game_dir = req["gameDir"]
    snap = decode_snapshot(req["image"])
    only = set((req.get("only") or [])[:8])
    cv2.setNumThreads(1)

    if os.path.basename(os.path.normpath(game_dir)) == "chainsaw-dance":
        templates = build_templates_gm(game_dir, only)
        engine = "gamemaker"
    else:
        templates = build_templates_fnf(game_dir, only)
        engine = "openfl"

    total_templates = len(templates)
    targeted = bool(only)

    # dedup dei template pixel-identici (frame ripetuti negli sheet FNF):
    # si confronta una volta il rappresentante, i match si espandono al gruppo
    groups = []
    rep_index = {}
    for t in templates:
        digest = hashlib.md5(np.ascontiguousarray(t["gray"]).tobytes()).hexdigest()
        if digest in rep_index:
            groups[rep_index[digest]][1].append(t)
        else:
            rep_index[digest] = len(groups)
            groups.append((t, [t]))

    snap_gray = cv2.cvtColor(snap, cv2.COLOR_BGR2GRAY)
    matcher = Matcher(snap_gray)
    H, W = snap_gray.shape

    evaluated = swept = 0
    matches = []
    t0 = time.time()
    time_limit_hit = False
    for rep, members in groups:
        if time.time() - t0 > 12:
            time_limit_hit = True
            break
        evaluated += 1
        tpl_gray = rep["gray"]
        th0, tw0 = tpl_gray.shape[:2]
        if float(tpl_gray.std()) < 2.0:
            continue  # uniforme: non localizzabile
        hits = []
        if targeted:
            for s in SCALES_TARGETED:
                hits += matcher.hits_at_scale(tpl_gray, s)
        else:
            for s in SCALES_SMALL if max(tw0, th0) <= 64 else (1.0,):
                hits += matcher.hits_at_scale(tpl_gray, s)
            if tw0 > W or th0 > H:
                for s in SCALES_OVERSIZED:
                    if tw0 * s <= W and th0 * s <= H:
                        hits += matcher.hits_at_scale(tpl_gray, s)
                        break
        # irrisolto e abbastanza grande: scansione di scala gerarchica
        if targeted and not hits and max(tw0, th0) >= MIN_OCCLUDED:
            swept += 1
            tried = 0
            for i, (score4, s0, x4, y4) in enumerate(matcher.sweep_scale(tpl_gray)):
                if score4 < SWEEP_MIN or (i > 0 and score4 < SWEEP_MIN2):
                    break
                if tried >= 1:
                    break
                tried += 1
                rh = matcher.refine_scale_half(tpl_gray, s0, x4, y4)
                if not rh or rh[0] < HALF_MIN:
                    continue
                s_best = rh[1]
                tw = int(round(tw0 * s_best)); th = int(round(th0 * s_best))
                if tw < MIN_TPL or th < MIN_TPL or tw > W or th > H:
                    continue
                tpl_s = tpl_at(tpl_gray, s_best, tw, th)
                r = refine(snap_gray, tpl_s, rh[2] * 2, rh[3] * 2, pad=10)
                if not r:
                    continue
                thr = THR_FULL if s_best == 1.0 else THR_SCALED
                if r[2] >= thr:
                    hits.append((r[0], r[1], r[2], tw, th, False, s_best))
                    break
                frac = tile_score(snap_gray, tpl_s, r[0], r[1])
                if frac >= TILE_FRAC_MIN:
                    hits.append((r[0], r[1], frac, tw, th, True, s_best))
                    break
            if not hits and min(tw0, th0) >= MIN_OCCLUDED and not targeted:
                pass  # la scansione di scala copre già l'occlusione via tile

        # dedup per centro tra scale, i netti prima degli occlusi
        hits.sort(key=lambda h: (-h[5], -h[2]))
        kept = []
        for h in hits:
            x, y, score, tw, th, occ, sc = h
            ok = True
            for k in kept:
                kx, ky, _, kw, kh, _, _ = k
                lim = max(tw, th, kw, kh) * 0.5
                if (x - kx) ** 2 + (y - ky) ** 2 <= lim * lim:
                    ok = False
                    break
            if ok:
                kept.append(h)
        for x, y, score, tw, th, occ, sc in kept[:8]:
            # espandi il match a tutti i membri del gruppo identico
            for member in members:
                meta = dict(member["meta"])
                meta["scale"] = sc
                if occ:
                    meta["occluded"] = True
                matches.append({
                    "id": member["id"], "name": member["name"],
                    "x": x, "y": y, "w": tw, "h": th,
                    "score": round(score, 4),
                    "meta": meta,
                })

    matches.sort(key=lambda m: -m["score"])
    seen = {}
    unique = []
    for m in matches:
        key = (m["id"], round(m["x"] / 4), round(m["y"] / 4), m["w"], m["h"])
        if key in seen:
            continue
        seen[key] = True
        unique.append(m)
    matches = unique[:MAX_MATCHES]
    return {
        "matches": matches,
        "stats": {
            "engine": engine,
            "snapshot": {"w": int(snap.shape[1]), "h": int(snap.shape[0])},
            "templates": total_templates,
            "evaluated": evaluated,
            "unique": len(groups),
            "scaleSweeps": swept,
            "matches": len(matches),
            "partial": True,
            "timeLimitHit": time_limit_hit,
            "templateLimit": MAX_TEMPLATES,
            "elapsedMs": int((time.time() - t0) * 1000),
        },
    }


def main():
    print(json.dumps(analyze(json.loads(sys.stdin.read())), ensure_ascii=False))


if __name__ == "__main__":
    main()
