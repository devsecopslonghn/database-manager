'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppShell from '../../../components/AppShell';
import LoadingState from '../../../components/LoadingState';
import StatusBadge from '../../../components/StatusBadge';
import { api, type Plan } from '../../../../lib/api';

export default function PlansPage(){const {targetId}=useParams<{targetId:string}>();const [plans,setPlans]=useState<Plan[]>();const [message,setMessage]=useState('');useEffect(()=>{api<{items:Plan[]}>(`/targets/${targetId}/plans`).then((r)=>setPlans(r.items)).catch((e)=>setMessage(e instanceof Error?e.message:'PLANS_FAILED'));},[targetId]);return <AppShell breadcrumb={`Tenant / Target / ${targetId} / Plans`}><div className="page-heading"><div><p className="eyebrow">PLAN & APPROVAL</p><h1>Migration plans</h1><p className="muted">Every execution is a fingerprinted, reviewable sequence.</p></div><Link className="button primary" href={`/targets/${targetId}/migrations`}>Build from inventory</Link></div>{message?<div className="alert danger-box">{message}</div>:null}{!plans&&!message?<LoadingState/>:null}<section className="panel">{plans?.length?<table><thead><tr><th>Plan</th><th>Status</th><th>Items</th><th>Fingerprint</th><th>Created</th></tr></thead><tbody>{plans.map((plan)=><tr key={plan.id}><td><Link className="text-link" href={`/plans/${plan.id}`}>{plan.id.slice(0,8)}…</Link></td><td><StatusBadge status={plan.status}/></td><td>{plan.items.length}</td><td className="code checksum">{plan.fingerprint.slice(0,16)}…</td><td className="small">{new Date(plan.createdAt).toLocaleString()}</td></tr>)}</tbody></table>:<div className="empty-state"><h2>No plans</h2><p className="muted">Create a plan after a successful repository sync.</p></div>}</section></AppShell>;}
