#!/usr/bin/env python3
"""Runs the built app with synthetic fixture data and isolated preferences."""
import argparse,hashlib,json,os,pathlib,shutil,subprocess,tempfile,uuid
root=pathlib.Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser();parser.add_argument('--settings',action='store_true');args=parser.parse_args()
app=root/'个人工作台.app/Contents/MacOS/Workbench'
if not app.exists():raise SystemExit('Build desktop/build.py first')
fixture=pathlib.Path(tempfile.mkdtemp(prefix='workbench-test-'))
for name in ['tasks.json','life.json','templates.json']:shutil.copy2(root/'00-入口/defaults'/name,fixture/name)
templates=json.loads((fixture/'templates.json').read_text());lane=next(l for l in templates['lanes'] if l['kind']=='work')
task={'id':'fixture','title':'验证项目','lane':lane['id'],'hours':1,'path':'','today':False,'next':'','outputs':[dict(o,need=1,got=0,status='todo',files=[],note='') for o in lane['outputs']]}
(fixture/'tasks.json').write_text(json.dumps({'version':1,'tasks':[task]},ensure_ascii=False))
out=root/'output/native-tests';out.mkdir(parents=True,exist_ok=True)
suite='cn.mushan.workbench.test.'+uuid.uuid4().hex
for i in range(2 if args.settings else 1):
 report=out/('settings-'+str(i)+'.json' if args.settings else 'tasks.json')
 env=dict(os.environ,WB_APP_DATA_DIR=str(fixture),WB_APP_PREFS_SUITE=suite,WB_APP_SMOKE_REPORT=str(report))
 if args.settings:
  env['WB_APP_SETTINGS_SMOKE']='1'
  if i:env['WB_APP_SETTINGS_RELOAD']='1'
 else:env['WB_APP_TEST_SCRIPT']=str(root/'desktop/smoke.js')
 subprocess.run([str(app)],env=env,check=True,timeout=90)
 result=json.loads(report.read_text());assert result.get('ready') and not result.get('errors'),result
 if args.settings:
  assert result['startup']=='today' and result['zoom']==1.1 and result['hasSettings'] and result['hasStatusItem'],result
  backup=json.loads(pathlib.Path(str(report)+'.backup.json').read_text())
  for name,doc in backup['files'].items():assert doc==json.loads((fixture/name).read_text()),name
 else:
  stored=json.loads((fixture/'tasks.json').read_text());assert any(t.get('next')=='退出自动保存验证' for t in stored['tasks'])
 print('PASS',report.name)
print('Fixture:',fixture,'; login state was read only, not modified')
