# Memora

Interface web para navegar e organizar o serviço [ai-memory](https://github.com/akitaonrails/ai-memory).
Este projeto é distribuído sob a licença GNU GPL v3.0 somente; consulte [LICENSE](./LICENSE).

## Desenvolvimento

1. Configure no `.env` uma chave mestra para criptografar as credenciais do node
   ai-memory: `MEMORA_CONFIG_ENCRYPTION_KEY`. Gere uma chave aleatória com
   `openssl rand -hex 32`; mantenha-a segura e persistente.
2. No servidor ai-memory, habilite a API de leitura (`AI_MEMORY_ENABLE_WEB=true`
   ou `--enable-web`). O painel usa `/api/v1` para descobrir escopos e ler páginas.
3. Rode `npm install` e `npm run dev`.
4. Abra o endereço que o Vite mostrar, normalmente `http://localhost:5173`, entre
   no painel, adicione um node pessoal em **Configurações** e selecione-o para
   conectar.

Para validar a aplicação, rode `npm test` e `npm run build`. A suíte automatizada
cobre autenticação/sessões, limites e origem das requisições, migração de
preferências do SQLite, conexão e criptografia de nodes, encaminhamento da API,
erros/redirects de upstream e proteção das ações administrativas.

## Docker

1. Copie `.env.docker.example` para `.env.docker` e gere uma chave mestra:

   ```sh
   cp .env.docker.example .env.docker
   openssl rand -hex 32
   ```

   Coloque o resultado em `MEMORA_CONFIG_ENCRYPTION_KEY` no `.env.docker` e mantenha
   essa chave junto do backup do volume. Sem ela, os tokens dos nodes salvos
   não podem ser descriptografados.
2. Inicie o serviço com `docker compose --env-file .env.docker up -d --build`.
3. Acesse `http://localhost:8080`.

O único container serve a interface e a API pelo mesmo processo Node.js; não há
um serviço web/API separado nem Nginx interno. A API usa a mesma porta e origem
da interface. O SQLite fica no volume Docker
`memora-data`. A porta publicada fica vinculada a `127.0.0.1`; use um proxy
HTTPS confiável para acesso remoto e defina `MANAGER_COOKIE_SECURE=true` no
`.env.docker`. Configure o proxy externo para encaminhar `Host`,
`X-Forwarded-Host` e `X-Forwarded-Proto` corretamente, necessários para a
validação de origem das ações autenticadas.

A imagem única é publicada no GitHub Container Registry como
`ghcr.io/stdmaru/memora`. Para usar uma versão específica com Compose, defina
`MEMORA_IMAGE_TAG` no `.env.docker` (por exemplo, `1.2.0`); por padrão, usa
`latest`. O pacote GHCR é privado inicialmente; autentique com `docker login
ghcr.io` antes de baixar, ou altere sua visibilidade no GitHub caso queira
disponibilizá-lo publicamente. Para usar a imagem publicada em vez de compilar
localmente, rode `docker compose --env-file .env.docker pull` e depois
`docker compose --env-file .env.docker up -d --no-build`.

## CI e releases

O GitHub Actions executa testes, build do frontend e build da imagem Docker única
em pushes para `dev`/`main` e em pull requests para essas branches. Releases são
manuais: não há release quando nenhum tag é enviado. Para publicar, atualize a
versão em `package.json` e `package-lock.json`, faça commit dessa versão na
branch `main`, crie um tag `v` no mesmo commit e envie ambos:

```sh
npm version 0.1.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore: release 0.1.0"
git tag v0.1.0
git push origin main
git push origin v0.1.0
```

O workflow roda somente para tags `v*`, valida o formato `vX.Y.Z` e exige que a
versão do tag seja igual à versão no `package.json`. Depois executa testes e
build, publica a imagem multi-arquitetura `linux/amd64` e `linux/arm64` no
GHCR e cria a release do GitHub. As notas da release são geradas pelo GitHub
com base nos commits e pull requests desde a release anterior; nenhum arquivo
`CHANGELOG.md` é atualizado automaticamente. Tags de pré-release, como
`v0.2.0-rc.1`, são publicadas como pré-release e não alteram a imagem `latest`.
Se a validação e a publicação das imagens concluírem, mas a criação da
GitHub Release falhar, primeiro incorpore a correção do workflow em `main`.
Depois, em **Actions → Release → Run workflow**, escolha a branch `main` e
informe a tag existente (por exemplo, `v0.1.0`). Esse modo revalida a versão e
cria somente a GitHub Release com notas geradas; não republica as imagens.

No primeiro acesso, o OOBE solicita nome, e-mail e senha para criar a primeira
conta de administrador no SQLite. O setup só pode ser concluído uma vez e inicia
uma sessão autenticada. Nos acessos seguintes, o painel exige login; a sessão
fica em cookie `HttpOnly`, `SameSite=Strict`, com validade de sete dias, e pode
ser encerrada pelo botão **Sair**. O banco guarda apenas o hash do token da
sessão.

O servidor usa SQLite embutido no Node.js (Node 22.13 ou mais recente). O banco
fica por padrão em `./data/ai-memory-manager.sqlite`; esse diretório é criado
automaticamente e o arquivo não é versionado. Defina `MANAGER_DB_PATH` para
usar outro caminho, preferencialmente absoluto em uma instalação de servidor.

O `.env` não é versionado. Cada conta pode cadastrar nodes pessoais pela
interface de Configurações. Os endpoints e tokens ficam no SQLite do servidor;
os tokens são criptografados. Nodes públicos e atribuições de acesso por usuário
ainda não estão disponíveis. O bearer de leitura pode ser omitido para nodes sem
autenticação; o bearer root administrativo é opcional e habilita operações
`/admin/*`, como escrita, renomeação, exclusão e restauração.

Configuração mínima do painel:

```dotenv
MEMORA_CONFIG_ENCRYPTION_KEY=chave-gerada-com-openssl-rand-hex-32
MANAGER_API_PORT=4174
MANAGER_DB_PATH=./data/ai-memory-manager.sqlite
```

Não perca `MEMORA_CONFIG_ENCRYPTION_KEY`: sem ela, os tokens salvos não podem
ser descriptografados. Fazer backup do banco sem guardar essa chave não basta.
As antigas variáveis `AI_MEMORY_MCP_URL`, `AI_MEMORY_AUTH_TOKEN`,
`AI_MEMORY_ADMIN_TOKEN`, `AI_MEMORY_WORKSPACE` e `AI_MEMORY_PROJECT` não são
mais usadas; cadastre e selecione nodes pela interface.

Se o painel estiver atrás de um proxy HTTPS, defina
`MANAGER_COOKIE_SECURE=true` para marcar o cookie de sessão como `Secure`.
Autenticação não substitui HTTPS nem controles de rede: mantenha o backend
acessível somente por um proxy confiável e não exponha o servidor de
desenvolvimento do Vite.

Este release cria apenas a conta administradora inicial e não oferece
isolamento para usuários não confiáveis; não opere o painel como serviço
multi-tenant compartilhado. Cadastre somente endpoints ai-memory confiáveis:
os bearers salvos são criptografados em repouso, mas enviados ao endpoint
configurado para autenticar as chamadas.

Para um servidor ai-memory sem autenticação em loopback, deixe o bearer de
leitura vazio. Não use esse modo ao expor o serviço na rede.

O servidor limita tentativas de login/configuração inicial por endereço e os
corpos das requisições por endpoint. Se houver um proxy HTTPS externo, configure
`MANAGER_COOKIE_SECURE=true` e restrinja o acesso direto à porta do serviço. A
limitação de tentativas considera o endereço de rede observado pelo Node; atrás
de um proxy, esse endereço pode ser o do próprio proxy.

## Dados locais e fonte de verdade

O SQLite guarda o último workspace/projeto por node, preferências pessoais de
tema, sessões autenticadas e uma trilha de auditoria das operações
administrativas, login e escrita. Tokens de sessão são armazenados como hash;
tokens do ai-memory são criptografados com AES-256-GCM usando
`MEMORA_CONFIG_ENCRYPTION_KEY`. O conteúdo Markdown das memórias não é
armazenado localmente. A conta inicial também fica nesse banco;
sua senha é armazenada com scrypt e salt aleatório. A preferência de tema da
conta é carregada no login; o OOBE usa a aparência do sistema.
O ai-memory continua sendo a fonte
de verdade para workspaces, projetos, páginas, sessões e checkpoints da
lixeira; esses dados são consultados pela API e não duplicados num cache local.
O banco usa WAL e deve ser mantido em disco persistente, com backup junto dos
outros dados locais do painel.

## Estado da integração

- Implementado: descoberta de workspaces/projetos e leitura/busca de páginas via API REST `/api/v1`.
- Implementado: listagem de sessões e leitura paginada das observações por sessão.
- Implementado: criação de workspace/projeto ao gravar a primeira memória via `POST /admin/write-page`; criar um workspace também exige informar seu primeiro projeto.
- Implementado: renomeação e exclusão administrativa de projetos/workspaces, com prévia de impacto antes de excluir.
- Implementado: visualização de relações tipadas e links entre memórias.
- Implementado: criação de categorias (com uma memória inicial `overview.md`), exclusão recuperável de categorias e exclusão em lote de memórias.
- Implementado: indicadores para memórias de sessão, incluindo estado de consolidação quando disponível.
- Implementado: consulta e restauração de itens da Lixeira. Exclusão permanente e esvaziamento não estão disponíveis porque a API do ai-memory não oferece operações para apagar checkpoints.
- Requer no servidor ai-memory: `AI_MEMORY_ENABLE_WEB=true` (ou `--enable-web`), que habilita o browser somente leitura e a API.
- Exclusões de memórias e categorias usam as operações administrativas root-only e movem cada página para os checkpoints recuperáveis da Lixeira.

O proxy da API de desenvolvimento escuta apenas em `127.0.0.1`. Não exponha o
servidor de desenvolvimento do Vite nem o backend diretamente à internet. Para
acesso remoto, use o Compose atrás de um proxy HTTPS confiável; a chave do
ai-memory nunca é embutida no frontend estático.

## Licença

GNU General Public License v3.0 somente (`GPL-3.0-only`). O texto integral está
em [LICENSE](./LICENSE).
