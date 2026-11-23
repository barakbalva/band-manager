import json, datetime, re
app = open('src/app.html').read()
srv = open('src/server.js').read()
ver = datetime.datetime.now(datetime.timezone.utc).strftime('%Y.%m.%d-%H%M')
out = srv.replace('__APP_HTML__', json.dumps(app)).replace('__VERSION__', ver)
open('worker.js','w').write(out)
print('worker.js', len(out), 'bytes, version', ver)
