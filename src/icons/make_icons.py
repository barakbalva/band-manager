# Builds the app icons from the BandBase logo (logo.jpg, 1024x1024): a tighter square around the shield.
# Run: cd src/icons && python3 make_icons.py
from PIL import Image
im = Image.open('logo.jpg').convert('RGB')
sq = im.crop((122, 120, 902, 900))  # 780x780 around the shield, keeps a little of the spotlight above it
for n in (180, 192, 512):
    sq.resize((n, n), Image.LANCZOS).save(f'icon-{n}.png', optimize=True)
