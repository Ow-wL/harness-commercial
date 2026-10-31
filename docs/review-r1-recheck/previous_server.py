"""c9a2f08 backend main을 메모리에서 실행. checkout·제품 파일 변경 없음."""
import subprocess
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
source = subprocess.check_output(['git', 'show', 'c9a2f08:backend/app/main.py'], cwd=ROOT).decode('utf-8')
name = 'backend.app.recheck_previous'
module = types.ModuleType(name)
module.__package__ = 'backend.app'
module.__file__ = str(ROOT / 'backend/app/main.py')
sys.modules[name] = module
exec(compile(source, 'git:c9a2f08:backend/app/main.py', 'exec'), module.__dict__)
if __name__ == '__main__':
    import uvicorn
    uvicorn.run(module.app, host='127.0.0.1', port=8001)
