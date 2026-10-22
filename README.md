# ai-memory-manager

Interface web para navegar e organizar o serviço [ai-memory](https://github.com/akitaonrails/ai-memory).

## Desenvolvimento

1. Preencha o `.env` com o endpoint MCP e uma chave com permissão de leitura.
2. No servidor ai-memory, habilite o browser/API de leitura (`AI_MEMORY_ENABLE_WEB=true` ou `--enable-web`). O painel usa `/api/v1` para descobrir workspaces/projetos e ler suas páginas.
3. Rode `npm install` e `npm run dev`.
4. Abra o endereço que o Vite mostrar, normalmente `http://localhost:5173`.

O `.env` não é versionado. `AI_MEMORY_AUTH_TOKEN` e `AI_MEMORY_ADMIN_TOKEN` são lidos apenas pelo servidor local e nunca enviados ao navegador. Uma chave `aim_...` é suficiente para leitura; renomear/excluir escopos exige o bearer root em `AI_MEMORY_ADMIN_TOKEN`, pois as rotas `/admin/*` são root-only. Mantenha esse painel em loopback confiável enquanto não houver autenticação própria para acesso remoto.

Configuração mínima:

```dotenv
AI_MEMORY_MCP_URL=https://memory.mdeb.com.br/mcp
AI_MEMORY_AUTH_TOKEN=aim_...
AI_MEMORY_ADMIN_TOKEN=
AI_MEMORY_WORKSPACE=nome-exato
AI_MEMORY_PROJECT=nome-exato
MANAGER_API_PORT=4174
```

Para um servidor sem autenticação em loopback, deixe `AI_MEMORY_AUTH_TOKEN` vazio. Não use esse modo ao expor o serviço na rede.

## Estado da integração

- Implementado: descoberta de workspaces/projetos e leitura/busca de páginas via API REST `/api/v1`.
- Implementado: listagem de sessões e leitura paginada das observações por sessão.
- Implementado: renomeação e exclusão administrativa de projetos/workspaces, com prévia de impacto antes de excluir.
- Requer no servidor ai-memory: `AI_MEMORY_ENABLE_WEB=true` (ou `--enable-web`), que habilita o browser somente leitura e a API.
- Próximo: revisão/limpeza assistida de sessões e editor Markdown com gravação condicional via MCP.
- Depois: relações, lixeira e trilha de auditoria.

O proxy da API de desenvolvimento escuta apenas em `127.0.0.1`. A publicação remota exige configurar autenticação e um backend de produção; a chave ai-memory não pode ser embutida no frontend estático.

