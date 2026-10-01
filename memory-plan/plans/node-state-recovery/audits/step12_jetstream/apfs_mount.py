import ctypes
import os
import pathlib
import sys


MNT_IGNORE_OWNERSHIP = 0x00200000


class StatfsPrefix(ctypes.Structure):
    _fields_ = [('bsize', ctypes.c_uint32), ('iosize', ctypes.c_int32),
                ('blocks', ctypes.c_uint64), ('bfree', ctypes.c_uint64),
                ('bavail', ctypes.c_uint64), ('files', ctypes.c_uint64),
                ('ffree', ctypes.c_uint64), ('fsid', ctypes.c_int32 * 2),
                ('owner', ctypes.c_uint32), ('type', ctypes.c_uint32),
                ('flags', ctypes.c_uint32), ('subtype', ctypes.c_uint32),
                ('fstype', ctypes.c_char * 16)]


def apfs_mount_flags(path):
    if sys.platform != 'darwin':
        raise RuntimeError('APFS mount inspection requires macOS')
    library = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
    library.statfs.argtypes = [ctypes.c_char_p, ctypes.c_void_p]
    library.statfs.restype = ctypes.c_int
    buffer = ctypes.create_string_buffer(4096)
    if library.statfs(os.fsencode(pathlib.Path(path)), buffer) != 0:
        raise OSError(ctypes.get_errno(), 'statfs failed', str(path))
    result = ctypes.cast(buffer, ctypes.POINTER(StatfsPrefix)).contents
    if result.fstype != b'apfs':
        raise RuntimeError('store source is not APFS')
    return result.flags
