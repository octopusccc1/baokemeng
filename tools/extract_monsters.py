"""Extract the supplied sticker sheet without deleting white character details."""
from collections import deque
from pathlib import Path
import json

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = next((ROOT / '资源文件').glob('*.webp'))
OUTPUT = ROOT / 'assets' / 'monsters'
OUTPUT.mkdir(parents=True, exist_ok=True)

image = Image.open(SOURCE).convert('RGB')
pixels = np.asarray(image).astype(np.int16)
low, high = pixels.min(axis=2), pixels.max(axis=2)
foreground = (low < 210) | ((high - low > 15) & (low < 246))
mask = np.asarray(Image.fromarray(foreground.astype('uint8') * 255).filter(ImageFilter.MaxFilter(3))) > 0
height, width = mask.shape
labels = np.zeros(mask.shape, dtype=np.int32)
components = []

for y, x in zip(*np.where(mask)):
    if labels[y, x]:
        continue
    label = len(components) + 1
    labels[y, x] = label
    queue = deque([(int(x), int(y))])
    count = 0
    x0 = x1 = int(x)
    y0 = y1 = int(y)
    while queue:
        px, py = queue.popleft()
        count += 1
        x0, x1 = min(x0, px), max(x1, px)
        y0, y1 = min(y0, py), max(y1, py)
        for nx, ny in ((px-1, py), (px+1, py), (px, py-1), (px, py+1)):
            if 0 <= nx < width and 0 <= ny < height and mask[ny, nx] and not labels[ny, nx]:
                labels[ny, nx] = label
                queue.append((nx, ny))
    components.append({'label': label, 'count': count, 'box': [x0, y0, x1+1, y1+1]})

characters = [c for c in components if c['count'] > 1800]
row_centers = [130, 365, 610, 845, 1070, 1270, 1480]
rows = [[] for _ in row_centers]
for component in characters:
    center = (component['box'][1] + component['box'][3]) / 2
    row_index = min(range(len(row_centers)), key=lambda i: abs(row_centers[i]-center))
    rows[row_index].append(component)
for row in rows:
    row.sort(key=lambda c: c['box'][0])
if [len(row) for row in rows] != [7, 8, 8, 7, 8, 7, 7]:
    raise RuntimeError(f'Unexpected character grouping: {[len(row) for row in rows]}')

names = [
    ['glaceon', 'sylveon', 'leafeon', 'ditto', 'flareon', 'chikorita', 'ditto-hat'],
    ['vaporeon', 'squirtle', 'charmander', 'jolteon', 'chimchar', 'turtwig', 'wobbuffet-hat', 'torchic'],
    ['bulbasaur', 'pikachu', 'tepig', 'snivy', 'piplup', 'treecko', 'totodile', 'charmander-side'],
    ['oshawott', 'pikachu-flower', 'togepi', 'togepi-hat', 'eevee-hat', 'gengar', 'jigglypuff'],
    ['pikachu-hat', 'meowth', 'bulbasaur-rest', 'pikachu-berry', 'slowpoke', 'froakie', 'horsea', 'oshawott-side'],
    ['chikorita-rest', 'chikorita-side', 'mudkip-rest', 'piplup-side', 'squirtle-rest', 'espeon-rest', 'cyndaquil'],
    ['eevee-berry', 'mudkip', 'bulbasaur-hat', 'espeon', 'eevee', 'umbreon', 'squirtle-hat'],
]

manifest = []
preview = Image.new('RGB', (8*190, 7*210), '#203b34')
draw = ImageDraw.Draw(preview)
for row_index, row in enumerate(rows):
    for col_index, component in enumerate(row):
        name = names[row_index][col_index]
        x0, y0, x1, y1 = component['box']
        # Isolate only this connected character, so neighboring fragments cannot enter.
        contour = Image.fromarray((labels[y0:y1, x0:x1] == component['label']).astype('uint8') * 255)
        # Flood the exterior only; enclosed white fur, eyes and teeth stay opaque.
        padded = Image.new('L', (contour.width+2, contour.height+2))
        padded.paste(contour, (1, 1))
        ImageDraw.floodfill(padded, (0, 0), 128)
        filled = np.asarray(padded)[1:-1, 1:-1]
        alpha = Image.fromarray(np.where(filled == 128, 0, 255).astype('uint8')).filter(ImageFilter.GaussianBlur(.45))
        cutout = image.crop((x0, y0, x1, y1)).convert('RGBA')
        cutout.putalpha(alpha)
        cutout.thumbnail((232, 232), Image.Resampling.LANCZOS)
        sprite = Image.new('RGBA', (256, 256))
        # Bottom-align every sprite at the same foot anchor.
        sprite.alpha_composite(cutout, ((256-cutout.width)//2, 244-cutout.height))
        sprite.save(OUTPUT / f'{name}.png', optimize=True)
        thumb = sprite.resize((178, 178), Image.Resampling.LANCZOS)
        preview.paste(thumb, (col_index*190+6, row_index*210+4), thumb)
        draw.text((col_index*190+10, row_index*210+186), name, fill='#e7f1d9')
        manifest.append({'id': name, 'file': f'{name}.png', 'sourceBox': component['box'], 'size': [256, 256]})

(OUTPUT / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
preview.save(OUTPUT / 'preview.jpg', quality=92)
print(f'Extracted {len(manifest)} transparent sprites into {OUTPUT}')
