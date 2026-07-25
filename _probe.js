const { spawnSync } = require('child_process')
const body = JSON.stringify({
  baseUrl: 'http://192.168.2.6:4999/server/index.php',
  apiKey: 'ef95851d8e432d4dfe032efd0834ffa2848990517',
  apiToken: 'db1dfc5dec4439f215d6f1ec217ba25c96686384',
  itemId: '674217846'
})
const r = spawnSync('curl.exe', ['-s', '-X', 'POST', 'http://localhost:3333/api/showdoc/tree', '-H', 'Content-Type: application/json', '--data-binary', body], { encoding: 'utf8' })
const s = r.stdout
if (s.trim().startsWith('<')) { console.log('HTML ERROR:', s.slice(0, 200)); process.exit(0) }
const o = JSON.parse(s)
console.log('catalog', o.catalog.length, 'pages', o.pages.length)
o.catalog.slice(0, 50).forEach(c => console.log(c.cat_id, '|', c.cat_name, '| lvl', c.level, '| parent', JSON.stringify(c.parent_cat_id)))
console.log('--- pages sample ---')
o.pages.slice(0, 15).forEach(p => console.log(p.page_id, '|', p.page_title, '| cat', JSON.stringify(p.cat_id)))
