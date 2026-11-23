import { ConnectedServiceManagementAuthority } from './connectedServiceManagement';

/**
 * Real management decisions for a daemon whose relay-confirmed account settings name it as the
 * managing machine (the account settings are the boundary this replaces).
 */
export function createManagingMachineConnectedServiceManagement(
  machineId = 'machine-1',
): ConnectedServiceManagementAuthority {
  const authority = new ConnectedServiceManagementAuthority({
    machineId: () => machineId,
    readSettings: () => ({ connectedServicesManagementV1: { v: 1, managingMachineId: machineId, poolsPaused: false } }),
  });
  authority.confirmSettingsRead(authority.beginConnection());
  return authority;
}
