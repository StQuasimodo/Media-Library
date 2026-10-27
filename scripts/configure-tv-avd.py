"""Declare the supported AVD RAM floor; app growth limits are applied in the guest."""
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
config.write_text('\n'.join(lines) + '\nhw.ramSize=1024\nvm.heapSize=256\n')
out = Path('.harness/tv-regression')
out.mkdir(parents=True, exist_ok=True)
(out / 'avd-request.json').write_text(json.dumps({'ramMiB': 1024, 'appGrowthLimitMiB': heap, 'vmMaximumMiB': 256, 'profile': os.environ['TV_PROFILE']}, indent=2) + '\n')
