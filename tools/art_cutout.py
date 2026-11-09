import sys, os, numpy as np
from PIL import Image
from scipy import ndimage
src, dst = sys.argv[1], sys.argv[2]; os.makedirs(dst, exist_ok=True)
for f in sorted(os.listdir(src)):
    if not f.endswith('.png'): continue
    im = np.array(Image.open(os.path.join(src, f)).convert('RGB')).astype(int)
    mn, mx = im.min(2), im.max(2)
    white = (mn > 225) & (mx - mn < 24)
    lab, _ = ndimage.label(white)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(edge))
    # drop small islands of foreground; keep the largest blob(s)
    fg = ~bg; fl, n = ndimage.label(fg)
    if n:
        sz = ndimage.sum(fg, fl, range(1, n + 1)); keep = [i + 1 for i, s in enumerate(sz) if s > sz.max() * .05]
        fg = np.isin(fl, keep)
    from skimage.morphology import convex_hull_image
    r_, b_ = im[..., 0], im[..., 2]
    shadow = (mn > 170) & (mx - mn < 50) & (b_ >= r_ - 2)   # pale bluish cast shadows
    ll, _ = ndimage.label(shadow | bg)
    e2 = set(np.unique(np.concatenate([ll[0], ll[-1], ll[:, 0], ll[:, -1]]))) - {0}
    fg = fg & ~np.isin(ll, list(e2))
    if f.startswith('bank'):
        ys = np.where(fg.any(1))[0]; top = ys.min() + (ys.max() - ys.min()) * .35
        h = convex_hull_image(fg); h[int(top):] = False; fg = fg | h
    a = (fg * 255).astype(np.uint8)
    ring = fg & ndimage.binary_dilation(~fg)
    a[ring] = np.clip((255 - mn[ring]) * 255 // 40, 60, 255)
    rgba = np.dstack([im.astype(np.uint8), a])
    ys, xs = np.where(a > 20); y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    out = Image.fromarray(rgba[y0:y1, x0:x1], 'RGBA')
    s = min(1, 256 / out.width); out = out.resize((round(out.width * s), round(out.height * s)), Image.LANCZOS)
    out.save(os.path.join(dst, f), optimize=True); print(f, out.size, os.path.getsize(os.path.join(dst, f)))
