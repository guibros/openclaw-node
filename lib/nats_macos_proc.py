import ctypes
import os
import struct
import sys

from nats_root_lock import Refused


PROC_PIDLISTFDS = 1
PROC_PIDTBSDINFO = 3
PROC_PIDFDVNODEPATHINFO = 2
PROC_PIDREGIONPATHINFO = 8
PROC_PIDVNODEPATHINFO = 9
PROX_FDTYPE_VNODE = 1
BSD_INFO_SIZE = 136
VNODE_PATH_SIZE = 1200
VNODE_PATHINFO_SIZE = 2352
VNODE_INFO_PATH_SIZE = 1176
VNODE_INFO_PATH_OFFSET = 152
REGION_PATH_SIZE = 1272
REGION_PATH_OFFSET = 248


def _library():
    if sys.platform != 'darwin':
        raise Refused('macOS process census requires Darwin')
    library = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
    library.proc_listallpids.argtypes = [ctypes.c_void_p, ctypes.c_int]
    library.proc_listallpids.restype = ctypes.c_int
    library.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64,
                                     ctypes.c_void_p, ctypes.c_int]
    library.proc_pidinfo.restype = ctypes.c_int
    library.proc_pidfdinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                       ctypes.c_void_p, ctypes.c_int]
    library.proc_pidfdinfo.restype = ctypes.c_int
    library.proc_pidpath.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
    library.proc_pidpath.restype = ctypes.c_int
    return library


def list_pids(library=None):
    library = library or _library()
    count = library.proc_listallpids(None, 0)
    if count <= 0:
        raise Refused('process list is unobservable')
    capacity = max(count + 256, 1024)
    values = (ctypes.c_int * capacity)()
    actual = library.proc_listallpids(values, ctypes.sizeof(values))
    if actual < 0 or actual >= capacity:
        raise Refused('process list changed or is incomplete')
    return sorted(set(pid for pid in values[:actual] if pid > 0))


def bsd_info(pid, library=None):
    library = library or _library()
    buffer = ctypes.create_string_buffer(BSD_INFO_SIZE)
    actual = library.proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, buffer, BSD_INFO_SIZE)
    if actual != BSD_INFO_SIZE:
        raise Refused('process identity is unobservable')
    fields = struct.unpack_from('<12I', buffer.raw)
    start_sec, start_usec = struct.unpack_from('<QQ', buffer.raw, 120)
    return {'pid': fields[3], 'ppid': fields[4], 'uid': fields[5],
            'gid': fields[6], 'nfiles': struct.unpack_from('<I', buffer.raw, 96)[0],
            'start_sec': start_sec, 'start_usec': start_usec,
            'name': buffer.raw[64:96].split(b'\0', 1)[0].decode(errors='replace')}


def executable(pid, library=None):
    library = library or _library()
    buffer = ctypes.create_string_buffer(4096)
    actual = library.proc_pidpath(pid, buffer, ctypes.sizeof(buffer))
    if actual <= 0:
        raise Refused('process executable is unobservable')
    return buffer.raw[:actual].split(b'\0', 1)[0].decode()


def arguments(pid):
    if sys.platform != 'darwin':
        raise Refused('macOS process arguments require Darwin')
    library = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
    library.sysctl.argtypes = [ctypes.POINTER(ctypes.c_int), ctypes.c_uint,
                               ctypes.c_void_p, ctypes.POINTER(ctypes.c_size_t),
                               ctypes.c_void_p, ctypes.c_size_t]
    library.sysctl.restype = ctypes.c_int
    mib = (ctypes.c_int * 3)(1, 49, pid)
    size = ctypes.c_size_t()
    if library.sysctl(mib, 3, None, ctypes.byref(size), None, 0) != 0 or size.value > 1 << 22:
        raise Refused('process arguments are unobservable')
    buffer = ctypes.create_string_buffer(size.value)
    if library.sysctl(mib, 3, buffer, ctypes.byref(size), None, 0) != 0 or size.value < 6:
        raise Refused('process arguments are unobservable')
    raw = buffer.raw[:size.value]
    argc = struct.unpack_from('<i', raw)[0]
    if not 0 < argc < 32768:
        raise Refused('process arguments are invalid')
    offset = raw.find(b'\0', 4)
    if offset < 0:
        raise Refused('process arguments are invalid')
    offset += 1
    while offset < len(raw) and raw[offset] == 0:
        offset += 1
    result = []
    for _ in range(argc):
        end = raw.find(b'\0', offset)
        if end < 0:
            raise Refused('process arguments are incomplete')
        result.append(raw[offset:end].decode(errors='replace'))
        offset = end + 1
    return result


def file_descriptors(pid, nfiles, library=None):
    library = library or _library()
    capacity = max(nfiles + 32, 128)
    while capacity <= 65536:
        buffer = ctypes.create_string_buffer(capacity * 8)
        actual = library.proc_pidinfo(pid, PROC_PIDLISTFDS, 0, buffer, len(buffer))
        if actual < 0 or actual % 8:
            raise Refused('process descriptors are unobservable')
        if actual == 0:
            if nfiles:
                raise Refused('process descriptors are unobservable')
            return []
        if actual < len(buffer):
            return [struct.unpack_from('<iI', buffer.raw, offset)
                    for offset in range(0, actual, 8)]
        capacity *= 2
    raise Refused('process descriptor list is too large')


def vnode_descriptor(pid, fd, library=None):
    library = library or _library()
    buffer = ctypes.create_string_buffer(VNODE_PATH_SIZE)
    actual = library.proc_pidfdinfo(pid, fd, PROC_PIDFDVNODEPATHINFO,
                                    buffer, VNODE_PATH_SIZE)
    if actual != VNODE_PATH_SIZE:
        raise Refused('process file identity is unobservable')
    device, mode, links, inode = struct.unpack_from('<IHHQ', buffer.raw, 24)
    path = buffer.raw[-1024:].split(b'\0', 1)[0].decode(errors='replace')
    return {'fd': fd, 'device': device, 'inode': inode,
            'mode': mode, 'links': links, 'path': path}


def working_directory(pid, library=None):
    library = library or _library()
    buffer = ctypes.create_string_buffer(VNODE_PATHINFO_SIZE)
    actual = library.proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0,
                                  buffer, VNODE_PATHINFO_SIZE)
    if actual != VNODE_PATHINFO_SIZE:
        raise Refused('process working directory is unobservable')
    device, mode, links, inode = struct.unpack_from('<IHHQ', buffer.raw)
    path = buffer.raw[VNODE_INFO_PATH_OFFSET:VNODE_INFO_PATH_SIZE].split(
        b'\0', 1)[0].decode(errors='replace')
    return {'device': device, 'inode': inode, 'mode': mode,
            'links': links, 'path': path}


def mapped_vnodes(pid, library=None):
    library = library or _library()
    address = 0
    mapped = {}
    for region in range(32768):
        buffer = ctypes.create_string_buffer(REGION_PATH_SIZE)
        actual = library.proc_pidinfo(pid, PROC_PIDREGIONPATHINFO, address,
                                      buffer, REGION_PATH_SIZE)
        if actual == 0:
            if region == 0:
                raise Refused('process memory regions are unobservable')
            return list(mapped.values())
        if actual != REGION_PATH_SIZE:
            raise Refused('process memory regions are unobservable')
        base, size = struct.unpack_from('<QQ', buffer.raw, 80)
        if size == 0 or base < address or base + size <= address or base + size >= 1 << 64:
            raise Refused('process memory regions changed during census')
        device, mode, links, inode = struct.unpack_from('<IHHQ', buffer.raw, 96)
        if inode:
            path = buffer.raw[REGION_PATH_OFFSET:].split(b'\0', 1)[0].decode(
                errors='replace')
            mapped[(device, inode, path)] = {
                'device': device, 'inode': inode, 'mode': mode,
                'links': links, 'path': path}
        address = base + size
    raise Refused('process memory region list is too large')


def snapshot(pid, library=None):
    library = library or _library()
    before = bsd_info(pid, library)
    path = executable(pid, library)
    argv = arguments(pid)
    vnodes = [vnode_descriptor(pid, fd, library)
              for fd, kind in file_descriptors(pid, before['nfiles'], library)
              if kind == PROX_FDTYPE_VNODE]
    cwd = working_directory(pid, library)
    mappings = mapped_vnodes(pid, library)
    after = bsd_info(pid, library)
    if before != after:
        raise Refused('process changed during census')
    return {**before, 'executable': path, 'arguments': argv,
            'vnodes': vnodes, 'cwd': cwd, 'mappings': mappings}


def vnode_snapshot(pid, library=None):
    library = library or _library()
    before = bsd_info(pid, library)
    vnodes = [vnode_descriptor(pid, fd, library)
              for fd, kind in file_descriptors(pid, before['nfiles'], library)
              if kind == PROX_FDTYPE_VNODE]
    cwd = working_directory(pid, library)
    mappings = mapped_vnodes(pid, library)
    if before != bsd_info(pid, library):
        raise Refused('process changed during census')
    return {**before, 'vnodes': vnodes, 'cwd': cwd, 'mappings': mappings}
