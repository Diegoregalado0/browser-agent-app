# WCAG 2.x contrast check for the proposed Duomo UI tokens. Run: python3 brand/contrast.py
def lum(h):
    c = [int(h.lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

def ratio(a, b):
    hi, lo = sorted((lum(a), lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)

LIGHT = dict(bg="#F7F3EC", fg="#1E2433", muted="#6B6558", panel="#FFFFFF", border="#E4DBCC", accent="#B8471F",
             accent_fg="#FFFFFF", user="#F4E4D9", error="#B3261E", ok="#2E7D32", ghost_bg="#E3E8F1", ghost_fg="#3D5478", danger="#B42318")
DARK = dict(bg="#151A24", fg="#EDE7DC", muted="#A39B8C", panel="#1E2431", border="#343C4D", accent="#E8876A",
            accent_fg="#1A1210", user="#3A2B25", error="#F2B8B5", ok="#81C784", ghost_bg="#26334A", ghost_fg="#B9C9E6", danger="#F28B7D")
# (foreground, background, minimum): 4.5 for text, 3.0 for focus rings and UI parts.
PAIRS = [("fg", "bg", 4.5), ("fg", "panel", 4.5), ("fg", "user", 4.5), ("muted", "bg", 4.5), ("muted", "panel", 4.5),
         ("accent", "bg", 4.5), ("accent", "panel", 4.5), ("accent_fg", "accent", 4.5), ("error", "bg", 4.5), ("error", "panel", 4.5),
         ("ok", "bg", 4.5), ("ok", "panel", 4.5), ("danger", "bg", 4.5), ("danger", "panel", 4.5), ("ghost_fg", "ghost_bg", 4.5)]

if __name__ == "__main__":
    assert round(ratio("#000000", "#FFFFFF"), 2) == 21.0
    for name, t in (("light", LIGHT), ("dark", DARK)):
        for a, b, need in PAIRS:
            r = ratio(t[a], t[b])
            print(f"{name:5} {a:9} on {b:8} {r:5.2f}  {'pass' if r >= need else 'FAIL'}")
            assert r >= need, (name, a, b, r)
