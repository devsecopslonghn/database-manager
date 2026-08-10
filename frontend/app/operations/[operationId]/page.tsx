'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppShell from '../../components/AppShell';
import LoadingState from '../../components/LoadingState';
import StatusBadge from '../../components/StatusBadge';
import { api, type Operation } from '../../../lib/api';

type OperationView = Operation & { logs?: Array<{ sequence:number; stream:string; message:string; createdAt:string }> };
export default function OperationPage(){const {operationId}=useParams<{operationId:string}>();const [operation,setOperation]=useState<OperationView>();const [message,setMessage]=useState('');useEffect(()=>{api<OperationView>(`/operations/${operationId}`).then(setOperation).catch((e)=>setMessage(e instanceof Error?e.message:'OPERATION_FAILED'));},[operationId]);return <AppShell breadcrumb={`Tenant / Operation / ${operationId}`}><div className="page-heading"><div><p className="eyebrow">EXECUTION LOG</p><h1>Operation <span className="code">{operationId.slice(0,8)}</span></h1><p className="muted">Immutable operation metadata and redacted execution output.</p></div>{operation?<StatusBadge status={operation.status}/>:null}</div>{message?<div className="alert danger-box">{message}</div>:null}{!operation&&!message?<LoadingState/>:null}{operation?<><section className="metric-grid compact">{[['Type',operation.type],['Actor',operation.actorId],['Target',operation.targetId],['Correlation',operation.correlationId]].map(([label,value])=><article className="metric-card" key={label}><p className="label-caps">{label}</p><strong className="code value-small">{value}</strong></article>)}</section><section className="terminal"><div className="terminal-header">LIVE OPERATION OUTPUT <span>redacted=true</span></div>{operation.logs?.length?operation.logs.map((log)=><div className="terminal-line" key={log.sequence}><span>{String(log.sequence).padStart(4,'0')}</span><span className={log.stream==='stderr'?'danger-text':''}>{log.message}</span></div>):<div className="terminal-line muted">No log chunks persisted yet.</div>}</section></>:null}</AppShell>;}
