# Memora

Interface web para explorar e organizar memórias persistentes do
[ai-memory](https://github.com/akitaonrails/ai-memory). O Memora oferece uma
forma visual de navegar por workspaces e projetos, encontrar memórias, entender
suas relações e realizar operações administrativas sem expor as credenciais do
ai-memory ao navegador.

## Getting started

O servidor ai-memory conectado precisa habilitar a API web (`--enable-web` ou
`AI_MEMORY_ENABLE_WEB=true`). Gere uma chave mestra para criptografar tokens dos
nodes e mantenha-a guardada junto do backup do banco: sem ela, credenciais
salvas não podem ser descriptografadas.

### Node.js

Requer Node.js 22.13 ou mais recente. Para executar localmente:

```sh
npm ci
cp .env.example .env
```

Defina `MEMORA_CONFIG_ENCRYPTION_KEY` em `.env` com a saída de
`openssl rand -hex 32`, depois inicie frontend e API:

```sh
npm run dev
```

Abra o endereço indicado pelo Vite, normalmente `http://localhost:5173`.

Para executar o servidor Node servindo também os arquivos de produção:

```sh
npm run build
NODE_ENV=production npm run dev:api
```

A API escuta em `127.0.0.1:4174` por padrão. Configure a chave em `.env` antes
de iniciar.

### Docker

Com a imagem publicada no GHCR:

```sh
cp .env.docker.example .env.docker
# Defina MEMORA_CONFIG_ENCRYPTION_KEY em .env.docker
docker volume create memora-data
docker run -d --name memora --restart unless-stopped \
  --env-file .env.docker \
  -p 127.0.0.1:8080:8080 \
  -v memora-data:/app/data \
  ghcr.io/stdmaru/memora:latest
```

Crie `.env.docker` com `MEMORA_CONFIG_ENCRYPTION_KEY` antes de executar. Se o
pacote GHCR exigir autenticação, faça `docker login ghcr.io` primeiro.

### Docker Compose

```sh
cp .env.docker.example .env.docker
# Defina MEMORA_CONFIG_ENCRYPTION_KEY em .env.docker
docker compose --env-file .env.docker up -d --build
```

Acesse `http://localhost:8080`. O Compose executa um único container e mantém
os dados SQLite no volume `memora-data`. A porta fica vinculada ao loopback;
para acesso remoto, use um proxy HTTPS confiável e defina
`MANAGER_COOKIE_SECURE=true`. Preserve a mesma chave mestra ao reiniciar ou
atualizar o serviço.

## Contributing

Relatos de bugs e propostas são bem-vindos via GitHub Issues e Pull Requests.
Antes de enviar mudanças, rode:

```sh
npm ci
npm test
npm run build
```

Consulte [ARCHITECTURE.md](./ARCHITECTURE.md) para detalhes da organização,
integração e decisões técnicas.

## Tecnologias e créditos

- Vue 3 e TypeScript para a interface.
- Node.js, SQLite e Vite para servidor, persistência e build.
- Docker e Docker Compose para distribuição e implantação.
- Integração com [ai-memory](https://github.com/akitaonrails/ai-memory),
  criado por [akitaonrails](https://github.com/akitaonrails). O ai-memory é a
  fonte de verdade das memórias; o Memora é sua interface visual.

## Checklist

- [x] Login local e configuração inicial do administrador.
- [x] Cadastro de nodes pessoais com credenciais criptografadas.
- [x] Navegação, busca e edição de memórias, workspaces e projetos.
- [x] Visão geral, sessões, relações e restauração pela lixeira.
- [x] Imagem Docker única, Compose, CI, testes e publicação por tag.
- [ ] Nodes públicos/compartilhados e permissões por usuário.
- [ ] Exclusão permanente de memórias e limpeza definitiva da lixeira — depende
      de suporte correspondente na API do ai-memory.

O Memora ainda não oferece isolamento para usuários não confiáveis; não o
disponibilize como serviço multi-tenant compartilhado.

## License

[GNU GPL v3.0 only](./LICENSE) (`GPL-3.0-only`).
