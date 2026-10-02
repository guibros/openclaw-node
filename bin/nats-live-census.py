#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
from nats_live_census import observe
from nats_root_lock import Refused


def main():
    parser = argparse.ArgumentParser(description='Read-only NATS launchd, process and store census')
    parser.add_argument('--uid', type=int, default=os.getuid())
    parser.add_argument('--home', default=str(Path.home()))
    args = parser.parse_args()
    try:
        report = observe(args.uid, args.home)
    except Refused as error:
        parser.exit(2, f'NATS census refused: {error}\n')
    print(json.dumps(report, sort_keys=True, indent=2))


if __name__ == '__main__':
    main()
