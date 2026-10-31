"""Build APK with installed Android tools. Assets stay local; online is optional."""
from pathlib import Path
import os,sys,subprocess,zipfile,shutil,json,hashlib
android=Path(__file__).resolve().parent;project=android.parent
workspace=project.parents[1] if project.parent.name=='outputs' else project;work=workspace/'work/android-build';work.mkdir(parents=True,exist_ok=True)
sdk=Path(os.getenv('ANDROID_SDK_ROOT',str(Path.home()/'AppData/Local/Android/Sdk')))
tools=sdk/'build-tools/35.0.1'
jar=Path(os.getenv('ANDROID_JAR',str(workspace/'work/android-platform/android.jar')))
if not jar.is_file():raise SystemExit('Set ANDROID_JAR to an installed Android platform android.jar')
java=Path(shutil.which('java')).parent
def run(args):
 print('Running',Path(str(args[0])).name,flush=True);subprocess.run([str(x) for x in args],check=True)
assets_root=work/'assets'
# Remove only the verified build staging directory so previously excluded candidates cannot linger.
if assets_root.exists():
 if assets_root.resolve().parent!=work.resolve() or not work.resolve().is_relative_to((workspace/'work').resolve()):raise SystemExit('Unexpected staging path; refusing recursive cleanup')
 shutil.rmtree(assets_root)
assets=assets_root/'web';assets.mkdir(parents=True,exist_ok=True)
model_allowlist={'p2-swordsman-inplace.glb','p2-archer-inplace.glb','p2-paladin-inplace.glb','player-runtime.json'}
for model in model_allowlist:
 if not (project/'assets/models'/model).is_file():raise SystemExit('Missing explicitly required runtime model: '+model)
# Only explicit web assets enter APK; development tools and credentials are excluded.
for name in ['index.html','style.css'] :shutil.copy2(project/name,assets/name)
for name in ['src','vendor','assets']:
 if (project/name).exists():
  def exclude(directory,names):
   directory=Path(directory)
   return [n for n in names if n.endswith('.md') or (directory==project/'assets' and n=='references') or (directory==project/'assets/portraits' and n in {'swordsman.webp','paladin.webp','archer.webp'}) or (directory==project/'assets/models' and n not in model_allowlist)]
  shutil.copytree(project/name,assets/name,dirs_exist_ok=True,ignore=exclude)
classes=work/'classes';classes.mkdir(exist_ok=True)
sources=list((android/'src').rglob('*.java'))
run([java/'javac.exe','-encoding','UTF-8','-source','8','-target','8','-classpath',jar,'-d',classes,*sources])
classesjar=work/'classes.jar'
with zipfile.ZipFile(classesjar,'w') as z:
 for p in classes.rglob('*.class'):z.write(p,p.relative_to(classes).as_posix())
run([java/'java.exe','-cp',tools/'lib/d8.jar','com.android.tools.r8.D8','--min-api','24','--lib',jar,'--output',work,classesjar])
unsigned=work/'unsigned.apk'
run([tools/'aapt.exe','package','-f','-M',android/'AndroidManifest.xml','-I',jar,'-S',android/'res','-A',work/'assets','-F',unsigned])
with zipfile.ZipFile(unsigned,'a',compression=zipfile.ZIP_DEFLATED) as z:z.write(work/'classes.dex','classes.dex')
aligned=work/'aligned.apk';run([tools/'zipalign.exe','-f','4',unsigned,aligned])
keystore=work/'debug.keystore'
if not keystore.exists():run([java/'keytool.exe','-genkeypair','-keystore',keystore,'-storepass','android','-keypass','android','-alias','androiddebugkey','-dname','CN=Autumn Ruins Debug','-keyalg','RSA','-keysize','2048','-validity','10000'])
out=project/'builds';out.mkdir(exist_ok=True);apk=out/'autumn-ruins-debug.apk'
run([java/'java.exe','-jar',tools/'lib/apksigner.jar','sign','--ks',keystore,'--ks-pass','pass:android','--key-pass','pass:android','--out',apk,aligned])
run([java/'java.exe','-jar',tools/'lib/apksigner.jar','verify','--verbose',apk])
with zipfile.ZipFile(apk) as packaged:
 packaged_models=sorted(n.removeprefix('assets/web/assets/models/') for n in packaged.namelist() if n.startswith('assets/web/assets/models/'))
 if packaged_models!=sorted(model_allowlist):raise SystemExit('Packaged model allowlist mismatch')
report={'apk':str(apk),'bytes':apk.stat().st_size,'sha256':hashlib.sha256(apk.read_bytes()).hexdigest(),'offline_play':True,'optional_online_origin':'https://114.66.36.160:9443','debug_signature':True,'included_models':packaged_models,'excluded_assets':['assets/references/','all assets/models/ entries except included_models'],'excluded_docs':'*.md'}
(out/'build-report.json').write_text(json.dumps(report,indent=2),'utf-8');print(json.dumps(report),flush=True)
