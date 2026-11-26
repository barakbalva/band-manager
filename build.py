import json, datetime, re
app = open('src/app.html').read()
srv = open('src/server.js').read()
ver = datetime.datetime.now(datetime.timezone.utc).strftime('%Y.%m.%d-%H%M')
import base64
icons = {n: base64.b64encode(open(f'src/icons/icon-{n}.png','rb').read()).decode() for n in (180, 192, 512)}
out = srv.replace('__APP_HTML__', json.dumps(app)).replace('__VERSION__', ver).replace('__ICONS__', json.dumps(icons))
open('worker.js','w').write(out)
print('worker.js', len(out), 'bytes, version', ver)
