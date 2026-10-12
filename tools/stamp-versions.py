#!/usr/bin/env python3
"""Puts a content fingerprint (?v=...) on every CSS/JS file that index.html loads.

The site tells browsers to keep CSS/JS for a year, so a file is downloaded again
only when its fingerprint changes. Run this after editing any CSS/JS file by hand:

    python3 tools/stamp-versions.py

then deploy as usual. It is safe to run any number of times.
"""
import hashlib, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(HERE, '..', 'public')
INDEX = os.path.join(PUBLIC, 'index.html')

PLACEHOLDERS = {
    'APPCSS': 'app.css', 'APPJS': 'app.js', 'NOTESWORKSPACEJS': 'notes-workspace.js',
    'ACCCFG': 'accounts-config.js', 'ACCSPACE': 'accounts-space.js', 'LWC': 'vendor/lightweight-charts.js',
    'RPCFG': 'replay-data-config.js', 'RPSPACE': 'replay-space.js', 'ACCCSS': 'accounts-space.css', 'RPCSS': 'replay-space.css', 'DESKTOPAUTO': 'desktop-autologin.js',
}

def fingerprint(rel):
    with open(os.path.join(PUBLIC, rel), 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()[:10]

def main():
    with open(INDEX, encoding='utf-8') as f:
        s = f.read()
    for key, rel in PLACEHOLDERS.items():
        s = s.replace('@@' + key + '@@', fingerprint(rel))
    # Re-stamp already stamped references.
    for rel in PLACEHOLDERS.values():
        s = re.sub(r'(' + re.escape(rel) + r')\?v=[0-9a-f]{10}', lambda m: m.group(1) + '?v=' + fingerprint(rel), s)
    left = re.findall(r'@@[A-Z]+@@', s)
    if left:
        raise SystemExit('Unknown placeholders: ' + ', '.join(sorted(set(left))))
    with open(INDEX, 'w', encoding='utf-8') as f:
        f.write(s)
    print('index.html fingerprints updated')

if __name__ == '__main__':
    main()
