"""Fix the SDK's actual vm.heapSize key before a disposable API22 AVD boots."""
import json
import os
from pathlib import Path

assert os.environ.get('GITHUB_ACTIONS') == 'true', 'Only CI-created disposable AVDs may be modified.'
config = Path.home() / '.android/avd/test.avd/config.ini'
text = config.read_text()
assert 'android-22' in text
heap = int(os.environ['TV_HEAP_MIB'])
assert heap in [64, 96]
lines = [line for line in text.splitlines() if not line.startswith(('hw.heapSize=', 'vm.heapSize=', 'hw.ramSize='))]
config.write_text('\n'.join(lines) + f'\nhw.ramSize=1024\nvm.heapSize={heap}\n')
out = Path('.harness/tv-regression')
out.mkdir(parents=True, exist_ok=True)
(out / 'avd-request.json').write_text(json.dumps({'ramMiB': 1024, 'heapMiB': heap, 'profile': os.environ['TV_PROFILE']}, indent=2) + '\n')
