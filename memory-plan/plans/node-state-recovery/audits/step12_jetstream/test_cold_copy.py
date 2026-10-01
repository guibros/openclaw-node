import mmap
import os
import pathlib
import tempfile
import unittest

from cold_copy import copy_candidate
from preservation_checks import Refused


class CandidateCopy(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='openclaw-candidate-copy-')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.roots = {}
        for index in range(3):
            store = self.root / ('store-' + str(index))
            (store / 'jetstream').mkdir(parents=True)
            (store / 'jetstream' / 'state.dat').write_bytes(bytes([index]) * 8192)
            self.roots[str(index)] = store

    def test_copies_three_store_trees_as_uncertified_candidate(self):
        result = copy_candidate(self.roots, self.root / 'candidate')
        self.assertEqual(result['status'], 'candidate')
        self.assertEqual(result['files'], 3)
        for index in range(3):
            original = self.roots[str(index)] / 'jetstream' / 'state.dat'
            copied = self.root / 'candidate' / str(index) / 'jetstream' / 'state.dat'
            self.assertEqual(copied.read_bytes(), original.read_bytes())
            self.assertEqual(copied.stat().st_mode & 0o777, 0o600)

    def test_rejects_write_after_baseline(self):
        path = self.roots['1'] / 'jetstream' / 'state.dat'
        def change():
            with path.open('r+b') as handle:
                handle.write(b'changed')
        with self.assertRaisesRegex(Refused, 'source identity changed before copy'):
            copy_candidate(self.roots, self.root / 'candidate', after_baseline=change)

    def test_rejects_unflushed_mapped_write_after_baseline(self):
        path = self.roots['1'] / 'jetstream' / 'state.dat'
        mapping = None
        def change():
            nonlocal mapping
            with path.open('r+b') as handle:
                mapping = mmap.mmap(handle.fileno(), 8192, access=mmap.ACCESS_WRITE)
            mapping[0] = ord('x')
        try:
            with self.assertRaises(Refused):
                copy_candidate(self.roots, self.root / 'candidate', after_baseline=change)
        finally:
            if mapping is not None:
                mapping.close()

    def test_rejects_write_after_copy(self):
        path = self.roots['2'] / 'jetstream' / 'state.dat'
        def change():
            with path.open('r+b') as handle:
                handle.write(b'changed')
        with self.assertRaisesRegex(Refused, 'source stores changed across copy'):
            copy_candidate(self.roots, self.root / 'candidate', after_copy=change)

    def test_rejects_new_directory_entry(self):
        def change():
            (self.roots['0'] / 'jetstream' / 'extra').write_bytes(b'new')
        with self.assertRaisesRegex(Refused, 'source stores changed across copy'):
            copy_candidate(self.roots, self.root / 'candidate', after_copy=change)

    def test_rejects_symlink_and_hardlink(self):
        store = self.roots['0'] / 'jetstream'
        (store / 'alias').symlink_to(store / 'state.dat')
        with self.assertRaisesRegex(Refused, 'linked or non-regular'):
            copy_candidate(self.roots, self.root / 'candidate')
        (store / 'alias').unlink()
        os.link(store / 'state.dat', store / 'alias')
        with self.assertRaisesRegex(Refused, 'linked or non-regular'):
            copy_candidate(self.roots, self.root / 'candidate')

    @unittest.skipIf(os.geteuid() == 0, 'root can list a mode-000 directory')
    def test_rejects_unlistable_store_subdirectory(self):
        hidden = self.roots['0'] / 'jetstream' / 'hidden'
        hidden.mkdir()
        (hidden / 'state.dat').write_bytes(b'preserved')
        hidden.chmod(0)
        try:
            with self.assertRaisesRegex(Refused, 'store directory could not be listed'):
                copy_candidate(self.roots, self.root / 'candidate')
            self.assertFalse((self.root / 'candidate').exists())
        finally:
            hidden.chmod(0o700)


if __name__ == '__main__':
    unittest.main()
