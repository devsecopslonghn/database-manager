import { Client as PostgresClient } from 'pg';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import type { DatabaseEngine } from './domain.js';

export type TargetConnection = { host: string; port?: number; database: string; user: string; password: string; schema?: string; ssl?: boolean };
export type SecretResolver = { resolve(secretRef: string, targetId: string): Promise<TargetConnection | undefined> };

export interface DatabaseAdapter {
  begin(): Promise<void>;
  execute(sql: string): Promise<{ durationMs: number; message?: string }>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
}

export class AdapterConfigurationError extends Error { readonly code = 'TARGET_ADAPTER_NOT_CONFIGURED'; }

class PostgresAdapter implements DatabaseAdapter {
  constructor(private readonly client: PostgresClient) {}
  async begin() { await this.client.query('BEGIN'); }
  async execute(sql: string) { const started=Date.now(); const result=await this.client.query(sql); return {durationMs:Date.now()-started,message:`${result.rowCount ?? 0} rows affected`}; }
  async commit() { await this.client.query('COMMIT'); }
  async rollback() { await this.client.query('ROLLBACK').catch(()=>undefined); }
  async close() { await this.client.end(); }
}

type GenericDriver = { query(sql: string): Promise<unknown>; execute?(sql: string): Promise<unknown>; beginTransaction?(): Promise<void>; commit?(): Promise<void>; rollback?(): Promise<void>; end?(): Promise<void>; close?(): Promise<void> };

class GenericAdapter implements DatabaseAdapter {
  constructor(private readonly driver: GenericDriver, private readonly engine: DatabaseEngine) {}
  async begin() { if (this.driver.beginTransaction) await this.driver.beginTransaction(); else if (this.engine === 'sqlserver') await this.driver.query('BEGIN TRANSACTION'); else if (this.engine === 'oracle') await this.driver.query('SAVEPOINT schemaops_begin'); }
  async execute(sql: string) { const started=Date.now(); if(this.driver.execute) await this.driver.execute(sql); else await this.driver.query(sql); return {durationMs:Date.now()-started}; }
  async commit() { if(this.driver.commit) await this.driver.commit(); else if(this.engine === 'sqlserver') await this.driver.query('COMMIT TRANSACTION'); }
  async rollback() { if(this.driver.rollback) await this.driver.rollback(); else if(this.engine === 'sqlserver') await this.driver.query('ROLLBACK TRANSACTION'); }
  async close() { if(this.driver.end) await this.driver.end(); else if(this.driver.close) await this.driver.close(); }
}

export async function createDatabaseAdapter(engine: DatabaseEngine, connection: TargetConnection): Promise<DatabaseAdapter> {
  if (engine === 'postgresql') { const client=new PostgresClient({host:connection.host,port:connection.port,database:connection.database,user:connection.user,password:connection.password,ssl:connection.ssl?{rejectUnauthorized:false}:undefined}); await client.connect(); return new PostgresAdapter(client); }
  const require = createRequire(import.meta.url);
  try {
    if (engine === 'mysql') { const mysql=require('mysql2/promise') as {createConnection(options:unknown):Promise<GenericDriver>}; return new GenericAdapter(await mysql.createConnection({host:connection.host,port:connection.port,database:connection.database,user:connection.user,password:connection.password}),engine); }
    if (engine === 'oracle') { const oracle=require('oracledb') as {getConnection(options:unknown):Promise<GenericDriver>}; return new GenericAdapter(await oracle.getConnection({connectString:`${connection.host}:${connection.port ?? 1521}/${connection.database}`,user:connection.user,password:connection.password}),engine); }
    const mssql=require('mssql') as {connect(options:unknown):Promise<GenericDriver>}; return new GenericAdapter(await mssql.connect({server:connection.host,port:connection.port ?? 1433,database:connection.database,user:connection.user,password:connection.password,options:{encrypt:Boolean(connection.ssl),trustServerCertificate:false}}),engine);
  } catch (error) { throw new AdapterConfigurationError(`${engine} driver is not installed or connection failed: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'}`); }
}

export class MountedSecretResolver implements SecretResolver {
  constructor(private readonly directory = process.env.SCHEMAOPS_TARGET_SECRET_DIR ?? '/var/run/schemaops/targets') {}
  async resolve(secretRef: string, targetId: string): Promise<TargetConnection | undefined> {
    const safe = `${targetId}-${secretRef}`.replace(/[^a-zA-Z0-9_.-]/g, '_');
    try { return JSON.parse(await readFile(`${this.directory}/${safe}.json`, 'utf8')) as TargetConnection; } catch { return undefined; }
  }
}
