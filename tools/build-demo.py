#!/usr/bin/env python3
"""Build the demo page: index.html + mtt/core.js in one file, Firebase replaced by a stub (no login, nothing is saved in the cloud).
usage: python3 tools/build-demo.py OUTPUT.html
The output has no <html>/<head>/<body> (the Artifact tool adds them); publish it with the Artifact tool (see CLAUDE.md)."""
import re, sys, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = open(os.path.join(root, 'index.html'), encoding='utf-8').read()
core = open(os.path.join(root, 'mtt', 'core.js'), encoding='utf-8').read()
head = s[s.index('<head>'):s.index('</head>')]
body = s[s.index('<body'):s.index('</body>')]; body = body[body.index('>') + 1:]
style = re.search(r'<style>.*?</style>', head, re.S).group(0)
font = re.search(r'<link href="https://fonts.googleapis.com/css2[^>]*>', head).group(0)
stub = """<script>
/* demo build: no Google login and no cloud; everything stays in this browser */
window.firebase=(function(){const user={uid:'demo',displayName:'デモ',email:'demo@example.com',isAnonymous:false};
const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});
const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});
auth.GoogleAuthProvider=function(){};
return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();
</script>"""
body = re.sub(r'<script src="https://www.gstatic.com/firebasejs/[^"]*"></script>\s*', '', body)
assert 'firebasejs' not in body, 'firebase script tags were not removed'
marker = '<script src="mtt/core.js"></script>'
assert marker in body, 'mtt/core.js script tag not found'
body = body.replace(marker, '<script>\n' + core + '\n</script>\n' + stub)
out = '<title>6-Max Lab デモ</title>\n' + font + '\n' + style + '\n' + body
open(sys.argv[1], 'w', encoding='utf-8').write(out)
print('wrote', sys.argv[1], len(out), 'bytes')
