# Resumo de Implementação: Correção de Erro de Fetch no Banco de Dados

## 1. O que foi implementado
Foi corrigido o erro `Database fetch error: Could not find a relationship between 'app_users' and 'organizations'` que estava impedindo o carregamento dos dados do painel principal (dashboard) no projeto `portal-contador-dartsoft`. A consulta única que tentava utilizar um relacionamento entre `app_users` e `organizations` foi desmembrada em duas consultas sequenciais para evitar a dependência do cache de relacionamentos (foreign keys) no schema do Supabase.

## 2. Quais arquivos foram modificados/criados
- **Modificado:** `app/dashboard/page.js`

## 3. Como funciona a nova funcionalidade
Ao invés de solicitar a tabela `app_users` e `organizations` na mesma requisição usando a sintaxe de join do Supabase (`organizations(nome_fantasia)`), o sistema agora:
1. Faz o fetch apenas dos dados do usuário (`organization_id` e `name`) em `app_users`.
2. Se o usuário possuir um `organization_id`, realiza uma segunda requisição independente na tabela `organizations` para buscar o `nome_fantasia`.
Dessa forma, contornamos a ausência do relacionamento explícito mapeado no banco sem a necessidade de recriar as constraints no Postgres.

## 4. Dependências adicionadas
- Nenhuma dependência nova foi adicionada.

## 5. Instruções de uso/testes
1. Abra o painel na URL `/dashboard` novamente.
2. O erro de "Database fetch error" não deverá mais aparecer no console.
3. As notas fiscais emitidas, bem como as informações no cabeçalho do portal (Nome da Empresa / Nome do Contador) devem voltar a carregar corretamente.
