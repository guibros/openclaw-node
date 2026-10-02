#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
from nats_root_lock import Refused
from nats_store_holder_census import observe


def main():
    parser = argparse.ArgumentParser(description='Read-only NATS store vnode holder census')
    parser.add_argument('--home', default=str(Path.home()))
    args = parser.parse_args()
    try:
        report = observe(args.home)
    except Refused as error:
        parser.exit(2, f'NATS holder census refused: {error}\n')
    print(json.dumps(report, sort_keys=True, indent=2))


if __name__ == '__main__':
    main()
