# Arquitetura do projeto

## Objetivo

O `ai-memory-manager` é uma interface humana para explorar, criar, editar,
relacionar, reorganizar e remover memórias persistentes compartilhadas entre IAs.

## Organização do código

O frontend usa Vue 3, TypeScript e Vite. A estrutura separa o shell da
aplicação, telas por funcionalidade, contratos compartilhados, acesso HTTP e
estilos:

```text
src/
  App.vue                 Shell, autenticação, escopo e estado compartilhado
  components/             Componentes reutilizáveis e telas de entrada
  features/
    memories/             Biblioteca, categorias e detalhes de memórias
    overview/             Visão geral
    projects/             Navegação e administração de projetos
    relations/            Relações entre memórias
    sessions/             Sessões e observações
    settings/             Preferências de aparência, conta e segurança
    trash/                Restauração de memórias
  services/               Acesso à API local do painel
  styles/                 Estilos globais e estilos organizados por área
  types/                  Tipos compartilhados do domínio
```

`App.vue` coordena autenticação, seleção de escopo, carregamento e mutações
compartilhadas. As telas de funcionalidade recebem os dados necessários por
props e comunicam intenções ao shell por eventos; não fazem chamadas diretas à
API. Tipos usados por mais de uma área ficam em `types/domain.ts`. A integração
HTTP do browser passa por `services/manager-api.ts`.

A tela de configurações expõe preferência de tema, dados da conta, seleção de
node pessoal, status de conexão/escopo e alteração de senha. O cadastro de
nodes é feito em modal e cada conta mantém seus próprios nodes e escopos. A
troca de senha exige a senha atual,
mantém a sessão usada na alteração e revoga as demais sessões da conta.

Essa divisão é intencionalmente direta: não há camada de estado global nem
abstrações adicionais enquanto o estado compartilhado puder ser coordenado
com clareza pelo shell.

## Integração e implantação

- O frontend chama a API local do painel. Ela mantém a chave no servidor e usa
  a API REST `/api/v1` do [ai-memory](https://github.com/akitaonrails/ai-memory)
  para navegação/leitura. O servidor ai-memory precisa habilitar `--enable-web`
  (isso também monta `/api/v1`).
- O painel inicia sem node selecionado. Cada conta pode cadastrar nodes pessoais
  e selecionar um deles em Configurações; nodes compartilhados e atribuições
  individuais ficam para uma etapa futura.
- Tokens do node são criptografados no SQLite com AES-256-GCM. A chave mestra
  `MEMORA_CONFIG_ENCRYPTION_KEY` fica no ambiente do servidor do painel; não é
  uma credencial do node. Perdê-la impede descriptografar os tokens salvos.
- A API local do painel encaminha operações de escrita e administração com
  escopo validado.
- VPN reduz a exposição de rede, mas não substitui login nem controle de
  permissões.
- Nuxt continua uma opção se o projeto passar a exigir SSR, rotas de servidor
  ou sessões no mesmo deploy; não precisamos assumir essa complexidade agora.

## Banco local do painel

O backend usa SQLite via `node:sqlite` (Node.js 22.13+) para preferências do
painel, nodes pessoais com credenciais criptografadas, trilha de auditoria e contas
locais. O arquivo fica em `MANAGER_DB_PATH` (padrão
`./data/ai-memory-manager.sqlite`), com WAL habilitado. Tokens de sessão ficam
como hashes, as credenciais dos nodes pessoais são criptografadas e as senhas
locais usam hash scrypt com salt aleatório. A seleção e o escopo atual são
isolados por conta e node. Conteúdo Markdown não é armazenado localmente.
O ai-memory permanece como fonte de verdade para escopos, páginas, sessões e
checkpoints; não mantemos cópia local dessas entidades para evitar cache divergente.

O OOBE pode criar apenas o primeiro administrador e inicia sua sessão após a
criação. A tela de login autentica essa conta; todas as rotas da API do painel
exigem uma sessão válida, exceto status do setup e endpoints de login/sessão.
Tokens aleatórios de sessão são enviados somente em cookie `HttpOnly`,
`SameSite=Strict`, armazenados no SQLite como SHA-256 e expiram após sete dias.
Mutations exigem uma origem same-origin. Configure `MANAGER_COOKIE_SECURE=true`
quando o acesso HTTPS terminar em um proxy reverso.

Antes da autenticação, o OOBE usa somente `prefers-color-scheme`
(claro/escuro). A preferência pessoal fica em `user_preferences` e é carregada
depois do login, podendo acompanhar o sistema ou escolher tema claro/escuro.
Autenticação não substitui HTTPS, proxy confiável ou controles de rede; não
exponha o servidor de desenvolvimento do Vite.

## Fronteiras de segurança

1. A API deve ser a única credencializada para o serviço ai-memory; o browser
   nunca recebe tokens de backend ou acesso direto ao armazenamento.
2. A API local exige sessão autenticada; o cookie é `HttpOnly` e `SameSite=Strict`,
   e recebe `Secure` quando configurado para HTTPS. Ações mutáveis validam a
   origem.
3. Nodes pessoais e seleção de node são isolados por conta. O acesso a
   workspaces e projetos é delegado às credenciais configuradas no ai-memory.
4. Registro de auditoria para criar, editar, apagar, restaurar, mover e fundir
   memórias; operações destrutivas devem oferecer recuperação.
5. O proxy Nginx aplica cabeçalhos de segurança, CSP, limites de corpo e
   limitação de tentativas de login/setup. A API valida os dados de entrada e
   limita respostas recebidas dos nodes.

## Ponte com o ai-memory

A primeira fatia mapeia explicitamente ações da interface às superfícies
específicas do ai-memory, sem expor uma ponte genérica ao browser:

| Interface | Ferramenta MCP |
| --- | --- |
| Listar workspaces/projetos e páginas | REST `GET /api/v1/workspaces`, `/projects`, `.../pages` |
| Buscar no escopo atual | REST `GET /api/v1/search` |
| Abrir uma memória | REST `GET /api/v1/.../pages/{path}` |
| Listar sessões e observações | `memory_read_session_observations` (além da listagem a definir) |
| Criar workspace/projeto com a primeira memória | `memory_write_page` ou `POST /admin/write-page` (a escrita inicial cria o escopo) |
| Criar ou editar uma memória | `memory_write_page` ou `POST /admin/write-page` |
| Excluir uma ou várias memórias e recuperar | `memory_delete_page`, `memory_restore_page` |
| Criar categoria | `memory_write_page` ou `POST /admin/write-page` (grava `overview.md`) |
| Excluir categoria | Listar as páginas no caminho da categoria e chamar `memory_delete_page` para cada uma |
| Apagar checkpoints definitivamente | Não suportado pela API; a interface não oferece purga nem esvaziamento da Lixeira |
| Auditoria de qualidade | `memory_lint` |

O adaptador aplica o escopo selecionado a todas as leituras e não encaminha
credenciais ao browser. A API REST `/api/v1` do ai-memory é somente leitura;
escritas e ações administrativas usam rotas `/admin/*` protegidas por bearer
root ou ferramentas MCP com autorização adequada.
