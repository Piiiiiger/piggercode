import { describe, expect, it } from 'vitest';

import { buildSharedFolderMountCommands, parseSshAddress } from './sharedFolderMountCommands';

describe('parseSshAddress', () => {
    it('reads the user, host and optional port', () => {
        expect(parseSshAddress('pigger@203.0.113.10:2222')).toEqual({ user: 'pigger', host: '203.0.113.10', port: 2222 });
        expect(parseSshAddress(' me@example.com ')).toEqual({ user: 'me', host: 'example.com', port: 22 });
        expect(parseSshAddress('me@[2001:db8::1]:2200')).toEqual({ user: 'me', host: '2001:db8::1', port: 2200 });
    });

    it.each(['example.com', 'me@', 'me@host:0', 'me@host:70000', 'me@host; rm -rf ~', 'm e@host'])('rejects %j', (raw) => {
        expect(parseSshAddress(raw)).toBeNull();
    });
});

describe('buildSharedFolderMountCommands', () => {
    it('mounts a folder in the remote home on Linux', () => {
        expect(buildSharedFolderMountCommands({
            platform: 'linux',
            address: { user: 'pigger', host: '203.0.113.10', port: 2222 },
            sharedFolderPath: '~/Downloads',
            mountDirName: 'PiggerShare',
        })).toEqual({
            install: 'sudo pacman -S sshfs',
            check: 'ssh -p 2222 pigger@203.0.113.10 echo ok',
            mount: 'mkdir -p ~/PiggerShare && sshfs -p 2222 pigger@203.0.113.10:Downloads ~/PiggerShare -o reconnect,ServerAliveInterval=15',
            unmount: 'fusermount3 -u ~/PiggerShare',
        });
    });

    it('quotes a folder with spaces and leaves out the default port on macOS', () => {
        expect(buildSharedFolderMountCommands({
            platform: 'macos',
            address: { user: 'me', host: 'example.com', port: 22 },
            sharedFolderPath: '/srv/team share',
            mountDirName: 'PiggerShare',
        })).toEqual({
            install: 'brew tap macos-fuse-t/homebrew-cask\nbrew install --cask fuse-t fuse-t-sshfs',
            check: 'ssh me@example.com echo ok',
            mount: "mkdir -p ~/PiggerShare && sshfs 'me@example.com:/srv/team share' ~/PiggerShare -o reconnect,ServerAliveInterval=15",
            unmount: 'umount ~/PiggerShare',
        });
    });

    it('mounts the whole remote home for ~', () => {
        expect(buildSharedFolderMountCommands({
            platform: 'linux',
            address: { user: 'me', host: 'example.com', port: 22 },
            sharedFolderPath: '~',
            mountDirName: 'PiggerShare',
        }).mount).toBe('mkdir -p ~/PiggerShare && sshfs me@example.com: ~/PiggerShare -o reconnect,ServerAliveInterval=15');
    });
});
