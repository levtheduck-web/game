#!/usr/bin/env python3
"""Concatenate the WET PAINT modules into one self-contained html file."""
import json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.join(HERE, '..', 'wet-paint.html')

ORDER = ['01_font.js','02_core.js','03_palette.js','04_art.js','05_rooms.js',
         '06_overworld.js','07_editor.js','08_score.js','09_encounter.js',
         '10_sweep.js','11_results.js','12_story.js','13_audio.js','14_boot.js',
         '15_smoke.js']

head = open(os.path.join(HERE,'00_head.html'),encoding='utf-8').read()
parts = []
for name in ORDER:
    p = os.path.join(HERE,name)
    if not os.path.exists(p):
        print('  (missing, skipped)', name); continue
    src = open(p,encoding='utf-8').read()
    parts.append(f'\n/* ==================== {name} ==================== */\n' + src)

font = json.load(open('/tmp/font5x7.json'))
body = head.replace('/*__FONTDATA__*/', json.dumps(font))
body = body.replace('/*__MODULES__*/', '\n'.join(parts))

assert '__MODULES__' not in body and '__FONTDATA__' not in body
open(OUT,'w',encoding='utf-8').write(body)
size = len(body)
print(f'built {OUT}  {size:,} bytes  ({body.count(chr(10)):,} lines)')

# guards from the spec's definition-of-done
bad = []
code = re.sub(r'/\*.*?\*/', '', body, flags=re.S)
code = re.sub(r'(?m)^\s*//.*$', '', code)
code = code.replace("http://www.w3.org/2000/svg", "")   # favicon data-uri namespace
for pat, why in [(r'https?://','external URL'), (r'<img\b','img tag'),
                 (r'@font-face','webfont'), (r'\bfetch\s*\(','fetch'),
                 (r'strokeRect','strokeRect'), (r'shadowBlur','shadowBlur'),
                 (r'createLinearGradient','gradient'), (r'ctx\.filter','filter')]:
    hits = len(re.findall(pat, code))
    if hits: bad.append(f'{why}: {hits}')
if bad: print('  GUARD WARNINGS:', '; '.join(bad))
else:   print('  guards: clean')
