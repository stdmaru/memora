# Arquitetura inicial

## Objetivo

O `ai-memory-manager` será uma interface humana para explorar, criar, editar,
relacionar, reorganizar e remover memórias persistentes compartilhadas entre IAs.

## Decisão inicial

- **Frontend:** Vue 3, TypeScript e Vite.
- **Integração:** o frontend chama a API local do painel. Ela mantém a chave no
  servidor, usa a API REST `/api/v1` do [ai-memory](https://github.com/akitaonrails/ai-memory)
  para navegação/leitura, e usará MCP para operações de escrita com escopo
  validado. O servidor ai-memory precisa habilitar `--enable-web` (isso também
  monta `/api/v1`).
- **Publicação remota:** VPN reduz a exposição de rede, mas não substitui login
  nem controle de permissões.

Nuxt continua uma opção se o projeto passar a exigir SSR, rotas de servidor ou
sessões no mesmo deploy; não precisamos assumir essa complexidade agora.

## Fronteiras de segurança

1. A API deve ser a única credencializada para o serviço ai-memory; o browser
   nunca recebe tokens de backend ou acesso direto ao armazenamento.
2. Login com OIDC/OAuth2, cookies `HttpOnly`, `Secure` e `SameSite`, expiração
   curta e proteção CSRF para ações mutáveis.
3. Autorização por usuário e projeto em todas as rotas.
4. Registro de auditoria para criar, editar, apagar, restaurar, mover e fundir
   memórias; operações destrutivas devem oferecer recuperação.
5. Cabeçalhos de segurança, limite de requisições, validação de entrada e
   proteção contra XSS antes da abertura remota.

## Ponte com o ai-memory

A primeira fatia mapeia explicitamente ações da interface às superfícies
específicas do ai-memory, sem expor uma ponte genérica ao browser:

| Interface | Ferramenta MCP |
| --- | --- |
| Listar workspaces/projetos e páginas | REST `GET /api/v1/workspaces`, `/projects`, `.../pages` |
| Buscar no escopo atual | REST `GET /api/v1/search` |
| Abrir uma memória | REST `GET /api/v1/.../pages/{path}` |
| Listar sessões e observações | `memory_read_session_observations` (além da listagem a definir) |
| Criar ou editar | `memory_write_page` |
| Excluir e recuperar | `memory_delete_page`, `memory_restore_page` |
| Auditoria de qualidade | `memory_lint` |

O adaptador aplica o escopo selecionado a todas as leituras e não encaminha
credenciais ao browser. A API REST do ai-memory é somente leitura; ações
administrativas e mutações continuam fora desta fatia e exigirão controles
específicos de autorização, confirmação e auditoria.

## Próximos incrementos

1. Implementar edição Markdown e escrita condicional pelo MCP.
2. Conectar relações, lixeira/restauração e auditoria.
3. Implementar renomeação/exclusão de projetos e workspaces com confirmação e permissões root.
4. Implementar autenticação do painel antes de disponibilizar acesso pela VPN.
