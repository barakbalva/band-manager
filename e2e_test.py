import asyncio, json
from playwright.async_api import async_playwright
U='http://localhost:8787'
SONGS=[('Smells Like Teen Spirit','Nirvana','F#m','117','5:01','Eb standard'),('Black Hole Sun','Soundgarden','Eb','105','5:18','Drop D'),
       ('Rolling in the Deep','Adele','Cm','105','3:48',''),('Toxic','Britney Spears','Cm','143','3:19','Drop C'),('Zombie','The Cranberries','Em','84','5:06','')]
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch()
    errs=[]
    a=await b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,locale='he-IL')
    pg=await a.new_page(); pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('dialog',lambda d:asyncio.ensure_future(d.accept()))
    await pg.goto(U); await pg.wait_for_selector('#sf')
    await pg.screenshot(path='/home/claude/test/01-setup.png')
    await pg.fill('#nm','Barak'); await pg.fill('#apw','admin123'); await pg.fill('#bpw','ctrlv2026')
    await pg.click('#sf button.btn.primary'); await pg.wait_for_selector('nav.tabs')
    for t,ar,k,bpm,d,tu in SONGS:
      await pg.click('#add'); await pg.wait_for_selector('.sheet #sf')
      f='.sheet #sf '
      await pg.fill(f+'[name=title]',t); await pg.fill(f+'[name=artist]',ar); await pg.fill(f+'[name=key]',k); await pg.fill(f+'[name=bpm]',bpm); await pg.fill(f+'[name=duration]',d); await pg.fill(f+'[name=tuning]',tu)
      if t=='Zombie':
        await pg.fill(f+'[name=notes]','Intro: drums alone 4 bars\nMieke starts acapella')
        await pg.fill(f+'[name=chords]','[Verse]\nEm        C\nAnother head hangs lowly\nG          D/F#\nChild is slowly taken\n\n[Chorus]\nEm   C   G   D')
        await pg.fill(f+'[name=midi]','12')
      await pg.click(f+'button.btn.primary'); await pg.wait_for_selector('.sheet',state='detached')
    await pg.screenshot(path='/home/claude/test/02-songs.png')
    await pg.click('nav.tabs button[data-t=setlists]'); await pg.click('#add'); await pg.wait_for_selector('#slb')
    await pg.fill('#f_name','Trix Antwerpen'); await pg.dispatch_event('#f_name','change'); await pg.fill('#f_venue','Trix'); await pg.dispatch_event('#f_venue','change')
    await pg.click('#adds'); await pg.wait_for_selector('#pl')
    for t in ['Zombie','Toxic','Black Hole Sun']: await pg.click(f'#pl li:has-text("{t}")')
    await pg.screenshot(path='/home/claude/test/03-pick.png')
    await pg.click('#pdone'); await pg.wait_for_selector('#ent li')
    await pg.click('#addb')
    await pg.click('#adds'); await pg.wait_for_selector('#pl'); await pg.click('#pl li:has-text("Smells")'); await pg.click('#pdone')
    await pg.wait_for_timeout(300)
    # drag first song (Zombie) below Toxic
    h=await pg.query_selector_all('#ent li .handle'); b0=await h[0].bounding_box(); b1=await h[1].bounding_box()
    await pg.mouse.move(b0['x']+10,b0['y']+10); await pg.mouse.down(); await pg.mouse.move(b1['x']+10,b1['y']+30,steps=8); await pg.mouse.up()
    await pg.wait_for_timeout(500)
    order=await pg.eval_on_selector_all('#ent li .title','els=>els.map(e=>e.textContent)')
    print('order after drag',order)
    await pg.screenshot(path='/home/claude/test/04-setlist.png')
    await pg.click('#stg'); await pg.wait_for_selector('#stage')
    await pg.click('#slead'); await pg.wait_for_timeout(300)
    await pg.screenshot(path='/home/claude/test/05-stage1.png')
    # member login in second context
    m=await b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,locale='nl-BE')
    mp=await m.new_page(); mp.on('pageerror',lambda e:errs.append('M:'+str(e)))
    await mp.goto(U); await mp.wait_for_selector('#lf'); await mp.fill('#pw','wrong'); await mp.click('#lf button'); await mp.wait_for_selector('.err:not(:empty)')
    await mp.fill('#pw','ctrlv2026'); await mp.fill('#nm','Mieke'); await mp.click('#lf button'); await mp.wait_for_selector('nav.tabs')
    n=await mp.eval_on_selector_all('#sl li','e=>e.length'); print('member sees songs',n)
    await mp.click('nav.tabs button[data-t=setlists]'); await mp.click('#ll li'); await mp.click('#stg'); await mp.wait_for_selector('#stage'); await mp.wait_for_timeout(800)
    print('member follow pill', await mp.get_attribute('#sfollow','class'))
    await pg.click('#sn'); await pg.wait_for_timeout(300); await pg.click('#sn'); await pg.wait_for_timeout(2800)
    print('leader title', await pg.text_content('#sm'), '| member', await mp.text_content('#sm'))
    await mp.screenshot(path='/home/claude/test/06-member-follow.png')
    await pg.click('#sn'); await pg.wait_for_timeout(300); await pg.screenshot(path='/home/claude/test/07-stage-break.png')
    # member must not access admin
    r=await mp.evaluate("fetch('/api/admin/app').then(r=>r.status)"); print('member admin status',r)
    # self-update by admin
    r=await pg.evaluate("fetch('/').then(r=>r.text()).then(h=>fetch('/api/admin/app',{method:'PUT',body:h.replace('<title>','<title>X')})).then(r=>r.json())"); print('selfupdate',r)
    await pg.click('#sx'); await pg.keyboard.press('Escape')
    await pg.goto(U+'/?x'); await pg.wait_for_selector('nav.tabs'); await pg.click('nav.tabs button[data-t=settings]'); await pg.screenshot(path='/home/claude/test/08-settings.png',full_page=True)
    await pg.click('#rv'); await pg.wait_for_timeout(1500)
    st=await pg.evaluate("fetch('/api/state').then(r=>r.json())"); print('custom after revert',st['custom'])
    # desktop english
    d=await b.new_context(viewport={'width':1280,'height':800},locale='en-US'); dp=await d.new_page()
    await dp.goto(U); await dp.fill('#pw','admin123'); await dp.click('#lf button'); await dp.wait_for_selector('nav.tabs'); await dp.screenshot(path='/home/claude/test/09-desktop.png')
    await dp.click('nav.tabs button[data-t=songs]'); await dp.click('#sl li:has-text("Zombie")'); await dp.wait_for_timeout(300); await dp.screenshot(path='/home/claude/test/10-edit.png')
    print('errors',errs)
    await b.close()
asyncio.run(main())
