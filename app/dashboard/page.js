'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { Download, FileText, Calendar, LogOut, CheckCircle, Package } from 'lucide-react';
import { getXmlNFSeAction, getXmlNFeAction, getPdfNFeAction, getPdfNFSeAction } from '../actions/fiscal';
import JSZip from 'jszip';
import { AlertCircle, XCircle, Info, Check } from 'lucide-react';

export default function DashboardPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [invoices, setInvoices] = useState([]);
    const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
    const [stats, setStats] = useState({ totalInfo: 0, totalValue: 0 });
    const [downloading, setDownloading] = useState(null); // ID da nota sendo baixada
    const [downloadType, setDownloadType] = useState(null); // 'xml' ou 'pdf'
    const [exporting, setExporting] = useState(false);
    const [userName, setUserName] = useState('');
    const [orgName, setOrgName] = useState('');
    const [modal, setModal] = useState({ show: false, title: '', message: '', type: 'info' });

    const showAlert = (message, title = 'Aviso', type = 'info') => {
        setModal({ show: true, title, message, type });
    };

    useEffect(() => {
        checkAuth();
    }, [period]);

    const checkAuth = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            router.push('/');
            return;
        }

        // Fetch User & Logic
        await fetchData(session.user.id);
    };

    const fetchData = async (userId) => {
        setLoading(true);
        try {
            // Get Organization ID
            const { data: user, error: userError } = await supabase
                .from('app_users')
                .select('organization_id, name, organizations(nome_fantasia)')
                .eq('auth_id', userId);

            if (userError) {
                console.error('Database fetch error:', userError);
                return;
            }

            if (!user || user.length === 0) {
                console.log('No linked profile found for Auth ID:', userId);
                setUserName('Acesso não configurado');
                setOrgName('Vincule sua conta ao painel da empresa');
                setLoading(false);
                return;
            }

            const userData = user[0];
            setUserName(userData.name);
            setOrgName(userData.organizations?.nome_fantasia);
            const orgId = userData.organization_id;


            // Calculate start and end of month
            const [year, month] = period.split('-');
            const startDate = `${year}-${month}-01`;
            const endDate = new Date(year, month, 0).toISOString().split('T')[0];

            // 2. Fetch Sales (NFe/NFCe)
            const { data: sales, error: salesError } = await supabase
                .from('sales')
                .select('*, clients(name)')
                .eq('organization_id', orgId)
                .gte('created_at', `${startDate}T00:00:00`)
                .lte('created_at', `${endDate}T23:59:59`)
                .not('nfe_id', 'is', null)
                .order('created_at', { ascending: false });

            if (salesError) throw salesError;

            // 3. Fetch NFSe (Services)
            const { data: services, error: servicesError } = await supabase
                .from('nfse')
                .select('*')
                .eq('organization_id', orgId)
                .gte('created_at', `${startDate}T00:00:00`)
                .lte('created_at', `${endDate}T23:59:59`)
                .order('created_at', { ascending: false });

            // 4. Fetch NFe (Modelo 55) from notas_fiscais
            const { data: nfeList, error: nfeError } = await supabase
                .from('notas_fiscais')
                .select('*')
                .eq('organization_id', orgId)
                .gte('created_at', `${startDate}T00:00:00`)
                .lte('created_at', `${endDate}T23:59:59`)
                .order('created_at', { ascending: false });

            // 5. Fetch NFCe (Modelo 65) from nfce
            const { data: nfceList, error: nfceError } = await supabase
                .from('nfce')
                .select('*')
                .eq('organization_id', orgId)
                .gte('created_at', `${startDate}T00:00:00`)
                .lte('created_at', `${endDate}T23:59:59`)
                .order('created_at', { ascending: false });

            // 6. Combine and Deduplicate by Reference (ref / nfe_id)
            const rawInvoices = [
                ...(sales || []).map(s => ({
                    ...s,
                    modelo: 'nfce',
                    nfe_id: s.nfe_ref || s.nfe_id, // prioritize ref
                    display_id: s.nfe_id
                })),
                ...(nfceList || []).map(n => ({
                    ...n,
                    nfe_id: n.focus_nfe_ref || n.id,
                    display_id: n.numero || n.focus_nfe_ref,
                    total: n.valor_total,
                    clients: { name: n.cliente_nome || 'Cliente Final' },
                    modelo: 'nfce'
                })),
                ...(nfeList || []).map(n => ({
                    ...n,
                    nfe_id: n.focus_nfe_ref || n.id,
                    display_id: n.numero || n.focus_nfe_ref,
                    total: n.valor_total,
                    clients: { name: n.cliente_nome || 'Cliente Final' },
                    modelo: 'nfe'
                })),
                ...(services || []).map(s => ({
                    ...s,
                    nfe_id: s.ref,
                    display_id: s.ref,
                    total: s.valor_servicos,
                    clients: { name: s.tomador_nome || 'Tomador não identificado' },
                    modelo: 'nfse'
                }))
            ];

            // Deduplicate to avoid showing same event from different tables
            const seenRefs = new Set();
            const allInvoices = rawInvoices.filter(inv => {
                if (!inv.display_id) return true;
                if (seenRefs.has(inv.display_id)) return false;
                seenRefs.add(inv.display_id);
                return true;
            }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

            setInvoices(allInvoices);

            const authorizedInvoices = allInvoices.filter(inv =>
                inv.status === 'autorizado' || inv.status === 'autorizada'
            );

            const totalValue = authorizedInvoices.reduce((acc, curr) => acc + (parseFloat(curr.total) || 0), 0);
            setStats({
                totalInfo: authorizedInvoices.length,
                totalValue: totalValue
            });



        } catch (err) {
            console.error('Data fetch error:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleDownload = async (invoice, type = 'xml') => {
        setDownloading(invoice.id);
        setDownloadType(type);
        try {
            const ref = invoice.nfe_id;
            // Determina se é serviço (NFSe) ou produto (NFe/NFCe)
            // Se não tiver campo 'type' explícito no banco, assumimos produto por padrão ou tentamos ambos?
            // O ideal é ter um campo. Vamos assumir que se invoice.type === 'service' é serviço.
            const isService = invoice.type === 'service' || invoice.modelo === 'nfse';

            let result;
            if (type === 'xml') {
                result = isService
                    ? await getXmlNFSeAction(ref, invoice)
                    : await getXmlNFeAction(ref);
            } else {
                // PDF
                result = isService
                    ? await getPdfNFSeAction(ref, invoice)
                    : await getPdfNFeAction(ref);
            }


            if (result.success && result.data) {
                if (type === 'xml') {
                    const xmlContent = result.data.raw || result.data;
                    const blob = new Blob([xmlContent], { type: 'application/xml' });
                    downloadBlob(blob, `${isService ? 'NFSe' : 'NFe'}-${ref}.xml`);
                } else {
                    // PDF (Base64)
                    if (result.data.base64) {
                        const blob = base64ToBlob(result.data.base64, 'application/pdf');
                        downloadBlob(blob, `${isService ? 'NFSe' : 'NFe'}-${ref}.pdf`);
                    } else {
                        // Fallback se vier URL
                        showAlert('PDF gerado, mas formato inesperado. Verifique console.', 'Erro no PDF', 'error');
                        console.log('PDF Result:', result);
                    }
                }
            } else {
                showAlert((result.error || 'Conteúdo não retornado'), `Erro no ${type.toUpperCase()}`, 'error');
            }

        } catch (err) {
            console.error(err);
            showAlert('Não foi possível processar o download da nota fiscal.', 'Erro de Processamento', 'error');
        } finally {
            setDownloading(null);
            setDownloadType(null);
        }
    };

    const handleExportBatch = async () => {
        const authorizedInvoices = invoices.filter(inv =>
            inv.status === 'autorizado' || inv.status === 'autorizada'
        );

        if (authorizedInvoices.length === 0) {
            showAlert('Não há notas autorizadas para exportar neste período.', 'Nenhuma Nota', 'info');
            return;
        }

        setExporting(true);
        const zip = new JSZip();
        let addedCount = 0;

        try {
            for (const invoice of authorizedInvoices) {
                const ref = invoice.nfe_id || invoice.display_id;
                const isService = invoice.type === 'service' || invoice.modelo === 'nfse';

                try {
                    const result = isService
                        ? await getXmlNFSeAction(ref, invoice)
                        : await getXmlNFeAction(ref);

                    if (result.success && result.data) {
                        const xmlContent = result.data.raw || result.data;
                        const filename = `${isService ? 'NFSe' : 'NFe'}-${ref}.xml`;
                        zip.file(filename, xmlContent);
                        addedCount++;
                    }
                } catch (err) {
                    console.error(`Erro ao obter XML para ${ref}:`, err);
                }
            }

            if (addedCount > 0) {
                const content = await zip.generateAsync({ type: 'blob' });
                downloadBlob(content, `XMLs-${period}.zip`);
            } else {
                showAlert('Nenhum XML disponível para exportação.', 'Aviso', 'warning');
            }
        } catch (err) {
            console.error('Erro na exportação em lote:', err);
            showAlert('Ocorreu um erro ao gerar o arquivo ZIP.', 'Erro na Exportação', 'error');
        } finally {
            setExporting(false);
        }
    };

    const base64ToBlob = (base64, type) => {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type });
    }

    const downloadBlob = (blob, filename) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        window.URL.revokeObjectURL(url);
    }

    const handleLogout = async () => {
        await supabase.auth.signOut();
        router.push('/');
    };

    // Componente de Modal Interno
    const AlertModal = () => {
        if (!modal.show) return null;

        const getIcon = () => {
            switch (modal.type) {
                case 'error': return <XCircle size={48} color="#ef4444" />;
                case 'warning': return <AlertCircle size={48} color="#f59e0b" />;
                case 'success': return <Check size={48} color="#10b981" />;
                default: return <Info size={48} color="#3b82f6" />;
            }
        };

        return (
            <div style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(4px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 9999, animation: 'fadeIn 0.2s ease-out'
            }}>
                <div style={{
                    background: 'white', padding: '2rem', borderRadius: '16px',
                    width: '90%', maxWidth: '400px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                    textAlign: 'center', animation: 'scaleUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)'
                }}>
                    <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'center' }}>
                        {getIcon()}
                    </div>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: '700', color: '#111827', marginBottom: '0.5rem' }}>{modal.title}</h3>
                    <p style={{ color: '#4b5563', lineHeight: '1.5', marginBottom: '1.5rem' }}>{modal.message}</p>
                    <button
                        onClick={() => setModal({ ...modal, show: false })}
                        style={{
                            width: '100%', padding: '0.75rem', borderRadius: '8px',
                            background: '#4338ca', color: 'white', border: 'none',
                            fontWeight: '600', cursor: 'pointer', transition: 'filter 0.2s'
                        }}
                        onMouseOver={(e) => e.target.style.filter = 'brightness(1.1)'}
                        onMouseOut={(e) => e.target.style.filter = 'none'}
                    >
                        Entendi
                    </button>
                </div>
                <style dangerouslySetInnerHTML={{
                    __html: `
                    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                    @keyframes scaleUp { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
                `}} />
            </div>
        );
    };

    return (
        <div style={{ minHeight: '100vh', background: '#f5f7fa', fontFamily: 'system-ui, sans-serif' }}>
            <AlertModal />
            {/* Header */}
            <header style={{ background: 'white', borderBottom: '1px solid #e5e7eb', padding: '1rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ background: '#4338ca', width: '36px', height: '36px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <FileText size={20} color="white" />
                    </div>
                    <div>
                        <h1 style={{ fontSize: '1.25rem', fontWeight: '700', color: '#111827', lineHeight: 1.2 }}>Portal do Contador</h1>
                        <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: 0 }}>{orgName || 'Carregando...'} • {userName}</p>
                    </div>
                </div>
                <button onClick={handleLogout} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#dc2626', background: 'none', border: 'none', fontWeight: '500', cursor: 'pointer', padding: '0.5rem 1rem', borderRadius: '6px', transition: 'background 0.2s' }}>
                    <LogOut size={18} /> Sair
                </button>
            </header>

            <main style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>

                {/* Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                    <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', border: '1px solid #e5e7eb' }}>
                        <p style={{ color: '#6b7280', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem' }}>Notas Emitidas ({period})</p>
                        <p style={{ fontSize: '2rem', fontWeight: '700', color: '#111827' }}>{stats.totalInfo}</p>
                    </div>
                    <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', border: '1px solid #e5e7eb' }}>
                        <p style={{ color: '#6b7280', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem' }}>Valor Total</p>
                        <p style={{ fontSize: '2rem', fontWeight: '700', color: '#059669' }}>{stats.totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                    </div>
                </div>

                {/* Main Table Card */}
                <div style={{ background: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', border: '1px solid #e5e7eb', overflow: 'hidden' }}>

                    {/* Toolbar */}
                    <div style={{ padding: '1.5rem', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                        <h2 style={{ fontSize: '1.125rem', fontWeight: '600', color: '#111827' }}>Notas Fiscais Emitidas</h2>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <button
                                onClick={handleExportBatch}
                                disabled={exporting || invoices.length === 0}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    background: exporting ? '#f3f4f6' : '#4338ca',
                                    color: exporting ? '#9ca3af' : 'white',
                                    padding: '0.625rem 1rem',
                                    borderRadius: '8px',
                                    border: 'none',
                                    fontSize: '0.875rem',
                                    fontWeight: '600',
                                    cursor: exporting || invoices.length === 0 ? 'not-allowed' : 'pointer',
                                    transition: 'all 0.2s',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                }}
                            >
                                {exporting ? 'Gerando ZIP...' : <><Package size={18} /> Exportar ZIP (XMLs)</>}
                            </button>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f9fafb', padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                                <Calendar size={18} color="#6b7280" />
                                <input
                                    type="month"
                                    value={period}
                                    onChange={(e) => setPeriod(e.target.value)}
                                    style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '0.9rem', color: '#374151', fontFamily: 'inherit' }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Table */}
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                            <thead>
                                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                                    <th style={{ padding: '1rem 1.5rem', fontWeight: '600', color: '#374151' }}>Emissão</th>
                                    <th style={{ padding: '1rem 1.5rem', fontWeight: '600', color: '#374151' }}>Tipo</th>
                                    <th style={{ padding: '1rem 1.5rem', fontWeight: '600', color: '#374151' }}>Referência</th>
                                    <th style={{ padding: '1rem 1.5rem', fontWeight: '600', color: '#374151' }}>Cliente</th>
                                    <th style={{ padding: '1rem 1.5rem', fontWeight: '600', color: '#374151' }}>Valor</th>
                                    <th style={{ padding: '1rem 1.5rem', fontWeight: '600', color: '#374151' }}>Status</th>
                                    <th style={{ padding: '1rem 1.5rem', fontWeight: '600', color: '#374151', textAlign: 'right' }}>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan="7" style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>Carregando dados...</td></tr>
                                ) : invoices.length === 0 ? (
                                    <tr><td colSpan="7" style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>Nenhuma nota encontrada no período selecionado.</td></tr>
                                ) : (
                                    invoices.map(invoice => (
                                        <tr key={`${invoice.modelo}-${invoice.id}`} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                            <td style={{ padding: '1rem 1.5rem', color: '#111827' }}>

                                                {new Date(invoice.created_at).toLocaleDateString('pt-BR')} <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>{new Date(invoice.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                                            </td>
                                            <td style={{ padding: '1rem 1.5rem' }}>
                                                <span style={{
                                                    fontSize: '0.7rem', fontWeight: '700', padding: '0.15rem 0.5rem', borderRadius: '4px',
                                                    whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center',
                                                    background: invoice.modelo === 'nfse' ? '#e0e7ff' : (invoice.modelo === 'nfce' ? '#fff7ed' : '#ecfdf5'),
                                                    color: invoice.modelo === 'nfse' ? '#3730a3' : (invoice.modelo === 'nfce' ? '#9a3412' : '#065f46')
                                                }}>
                                                    {invoice.modelo === 'nfse' ? 'NFS-e' : (invoice.modelo === 'nfce' ? 'NFC-e' : 'NF-e')}
                                                </span>
                                            </td>
                                            <td style={{ padding: '1rem 1.5rem', fontFamily: 'ui-monospace, monospace', color: '#4b5563' }}>{invoice.nfe_id || '-'}</td>
                                            <td style={{ padding: '1rem 1.5rem', fontWeight: '500', color: '#111827' }}>{invoice.clients?.name || 'Cliente Final'}</td>
                                            <td style={{ padding: '1rem 1.5rem', color: '#111827' }}>{parseFloat(invoice.total || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                                            <td style={{ padding: '1rem 1.5rem' }}>
                                                <span style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '0.25rem',
                                                    background: (invoice.status === 'autorizado' || invoice.status === 'autorizada') ? '#dcfce7' : '#fee2e2',
                                                    color: (invoice.status === 'autorizado' || invoice.status === 'autorizada') ? '#166534' : '#b91c1c',
                                                    padding: '0.25rem 0.625rem',
                                                    borderRadius: '9999px',
                                                    fontSize: '0.75rem',
                                                    fontWeight: '600'
                                                }}>
                                                    {invoice.status === 'autorizado' || invoice.status === 'autorizada' ? <CheckCircle size={12} /> : null}
                                                    {(invoice.status || 'Pendente').toUpperCase()}
                                                </span>
                                            </td>

                                            <td style={{ padding: '1rem 1.5rem', textAlign: 'right' }}>
                                                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                                    <button
                                                        onClick={() => handleDownload(invoice, 'xml')}
                                                        disabled={downloading === invoice.id}
                                                        title="Baixar XML"
                                                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '6px', background: 'white', color: '#374151', cursor: 'pointer', transition: 'all 0.2s' }}
                                                    >
                                                        {downloading === invoice.id && downloadType === 'xml' ? '...' : <><code style={{ fontWeight: 'bold', fontSize: '0.7rem' }}>XML</code></>}
                                                    </button>
                                                    <button
                                                        onClick={() => handleDownload(invoice, 'pdf')}
                                                        disabled={downloading === invoice.id}
                                                        title="Baixar PDF (DANFE)"
                                                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '6px', background: 'white', color: '#374151', cursor: 'pointer', transition: 'all 0.2s' }}
                                                    >
                                                        {downloading === invoice.id && downloadType === 'pdf' ? '...' : <><Download size={14} /></>}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </main>
        </div>
    );
}
