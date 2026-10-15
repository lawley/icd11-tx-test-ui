export interface ServerConfig {
  id: string;
  name: string;
  base: string;
  /** Runner modes for this server, e.g. icd-11, tx.fhir.org, ontoserver, flat. */
  modes: string[];
  /** Optional externals file (path under tests/), e.g. messages-tx.fhir.org.json. */
  externals?: string;
  enabled: boolean;
}

export const DEFAULT_SERVERS: ServerConfig[] = [
  {
    id: 'who-icdapi',
    name: 'WHO ICD-API',
    base: 'https://icdapi-fhir-testing-byfzd6budwdmbabf.northeurope-01.azurewebsites.net/fhir',
    modes: ['icd-11'],
    enabled: true,
  },
  {
    id: 'tx-fhir-org',
    name: 'tx.fhir.org',
    base: 'http://tx.fhir.org/r4',
    modes: ['icd-11', 'general', 'tx.fhir.org'],
    externals: 'messages-tx.fhir.org.json',
    enabled: true,
  },
  {
    id: 'ontoserver',
    name: 'Ontoserver',
    base: 'https://r4.ontoserver.csiro.au/fhir',
    modes: ['icd-11', 'general', 'ontoserver'],
    externals: 'messages-ontoserver.csiro.au.json',
    enabled: true,
  },
];

const KEY = 'icd11-tx-ui.servers.v1';

export function loadServers(): ServerConfig[] {
  try {
    const s = localStorage.getItem(KEY);
    if (s) {
      const parsed = JSON.parse(s) as ServerConfig[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SERVERS;
}

export function saveServers(servers: ServerConfig[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(servers));
  } catch {
    /* ignore */
  }
}
