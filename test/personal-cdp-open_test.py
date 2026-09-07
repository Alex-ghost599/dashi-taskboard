"""No live processes: verify refusal boundaries before any launch side effect."""
import importlib.util
from pathlib import Path
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('daily', Path(__file__).parents[1] / 'scripts/personal-cdp-open.py')
daily = importlib.util.module_from_spec(spec)
spec.loader.exec_module(daily)


class DailyLaunchTests(unittest.TestCase):
    def verify(self, command=None, environment=None, listeners='p42\nn127.0.0.1:9229\np43\nn127.0.0.1:9229\n'):
        command = command or daily.CODEX + ' --remote-debugging-address=127.0.0.1 --remote-debugging-port=9229'
        with patch.object(daily.subprocess, 'run', return_value=types.SimpleNamespace(stdout=listeners)), patch.object(
            daily.subprocess, 'check_output', side_effect=[
                f'42 1 {daily.CODEX}\n43 42 /Applications/ChatGPT.app/Contents/Resources/helper\n', command, environment or command
            ]):
            daily.verify_daily_port()

    def test_daily_and_inherited_socket_accepted(self):
        self.verify()

    def test_isolated_profile_refused(self):
        with self.assertRaises(SystemExit):
            self.verify(daily.CODEX + ' --user-data-dir=/tmp/isolate --remote-debugging-port=9229')

    def test_isolated_home_refused(self):
        with self.assertRaises(SystemExit):
            self.verify(environment=daily.CODEX + ' CODEX_HOME=/tmp/isolate HOME=/Users/test')

    def test_wildcard_refused(self):
        with self.assertRaises(SystemExit):
            self.verify(listeners='p42\nn*:9229\n')

    def test_unrelated_listener_refused(self):
        with self.assertRaises(SystemExit):
            self.verify(listeners='p44\nn127.0.0.1:9229\n')

    def test_inherited_custom_home_refused_before_launch(self):
        with patch.dict(daily.os.environ, {'CODEX_HOME': '/tmp/custom'}), patch.object(daily.subprocess, 'run') as run:
            with self.assertRaises(SystemExit):
                daily.main()
            run.assert_not_called()

    def test_running_without_cdp_refused_before_launch(self):
        with patch.dict(daily.os.environ, {'CODEX_HOME': str(Path.home() / '.codex')}), patch.object(Path, 'is_file', return_value=True), patch.object(daily, 'listening', return_value=False), patch.object(daily.subprocess, 'check_output', return_value=daily.CODEX), patch.object(daily.subprocess, 'run') as run:
            with self.assertRaises(SystemExit):
                daily.main()
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
