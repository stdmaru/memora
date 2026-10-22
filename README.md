# ai-memory-manager

Interface web para navegar e organizar o serviço [ai-memory](https://github.com/akitaonrails/ai-memory).

## Desenvolvimento

1. Preencha o `.env` com o endpoint MCP e uma chave com permissão de leitura.
2. No servidor ai-memory, habilite o browser/API de leitura (`AI_MEMORY_ENABLE_WEB=true` ou `--enable-web`). O painel usa `/api/v1` para descobrir workspaces/projetos e ler suas páginas.
3. Rode `npm install` e `npm run dev`.
4. Abra o endereço que o Vite mostrar, normalmente `http://localhost:5173`.

O servidor usa SQLite embutido no Node.js (Node 22.13 ou mais recente). O banco
fica por padrão em `./data/ai-memory-manager.sqlite`; esse diretório é criado
automaticamente e o arquivo não é versionado. Defina `MANAGER_DB_PATH` para
usar outro caminho, preferencialmente absoluto em uma instalação de servidor.

O `.env` não é versionado. `AI_MEMORY_AUTH_TOKEN` e `AI_MEMORY_ADMIN_TOKEN` são lidos apenas pelo servidor local e nunca enviados ao navegador. Uma chave `aim_...` é suficiente para leitura; renomear/excluir escopos exige o bearer root em `AI_MEMORY_ADMIN_TOKEN`, pois as rotas `/admin/*` são root-only. Mantenha esse painel em loopback confiável enquanto não houver autenticação própria para acesso remoto.

Configuração mínima:

```dotenv
AI_MEMORY_MCP_URL=https://memory.mdeb.com.br/mcp
AI_MEMORY_AUTH_TOKEN=aim_...
AI_MEMORY_ADMIN_TOKEN=
AI_MEMORY_WORKSPACE=nome-exato
AI_MEMORY_PROJECT=nome-exato
MANAGER_API_PORT=4174
MANAGER_DB_PATH=./data/ai-memory-manager.sqlite
```

Para um servidor sem autenticação em loopback, deixe `AI_MEMORY_AUTH_TOKEN` vazio. Não use esse modo ao expor o serviço na rede.

## Dados locais e fonte de verdade

O SQLite guarda preferências do painel (tema e último workspace/projeto) e uma
trilha de auditoria das operações administrativas e de escrita, sem armazenar
tokens nem o conteúdo Markdown das memórias. O ai-memory continua sendo a fonte
de verdade para workspaces, projetos, páginas, sessões e checkpoints da
lixeira; esses dados são consultados pela API e não duplicados num cache local.
O banco usa WAL e deve ser mantido em disco persistente, com backup junto dos
outros dados locais do painel.

## Estado da integração

- Implementado: descoberta de workspaces/projetos e leitura/busca de páginas via API REST `/api/v1`.
- Implementado: listagem de sessões e leitura paginada das observações por sessão.
- Implementado: renomeação e exclusão administrativa de projetos/workspaces, com prévia de impacto antes de excluir.
- Requer no servidor ai-memory: `AI_MEMORY_ENABLE_WEB=true` (ou `--enable-web`), que habilita o browser somente leitura e a API.
- Próximo: revisão/limpeza assistida de sessões e editor Markdown com gravação condicional via MCP.
- Depois: relações, lixeira e trilha de auditoria.

O proxy da API de desenvolvimento escuta apenas em `127.0.0.1`. A publicação remota exige configurar autenticação e um backend de produção; a chave ai-memory não pode ser embutida no frontend estático.

