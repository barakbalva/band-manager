# Builds the app icons from the Bandtwerp App logo (logo.jpg, 1024x1024): a tighter square around the shield.
# Run: cd src/icons && python3 make_icons.py
from PIL import Image
im = Image.open('logo.jpg').convert('RGB')
sq = im.crop((112, 88, 912, 888))  # 800x800 around the shield, room for the cathedral spire on top
for n in (180, 192, 512):
    sq.resize((n, n), Image.LANCZOS).save(f'icon-{n}.png', optimize=True)
