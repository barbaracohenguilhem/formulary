# Formulary — registro para retomar

Atualizado em **07/10/2026, 22:55 (America/Sao_Paulo)**.

**Trabalho encerrado por hoje a pedido da Barbara.** Este documento registra o
que foi feito e o que falta. Não continuar implementação, sincronização ou
publicação até ela pedir a retomada.

## 1. Estado ao encerrar

| Item | Estado verificado |
| --- | --- |
| Separação Carla / Barbara | Implementada e testada localmente |
| Compatibilidade com o robô da versão publicada | Recuperada e testada localmente |
| Último commit de implementação local | `1792cbd` — Preserve scheduled robot support and prepare static Vercel release |
| Branch de trabalho | `copilot/summarize-last-3-merged-prs` |
| Último commit dessa branch confirmado no GitHub | `84bee77`, consultado diretamente no remoto ao encerrar |
| Diferença da branch local para a remota | 1 commit de implementação para enviar, antes de acrescentar este registro |
| `main` no GitHub | `1e1fc251c6a2a283bce792bad9ad7b27dabf3936`; não presumir que é igual à branch de trabalho |
| Pull request ativo nesta sessão | Nenhum |
| Publicação das mudanças desta conversa | **Não realizada** |
| Agentes auxiliares desta conversa | Todos encerrados; nenhum continuando o trabalho |

O commit `84bee77` chegou ao GitHub e sua sincronização foi confirmada. Depois
disso, a comparação com o site publicado exigiu o ajuste adicional `1792cbd`.
Esse segundo commit ainda não chegou ao remoto. Este registro e o link no README
foram adicionados depois dele e também precisam ser incluídos na próxima
sincronização. Reconsultar o Git na retomada: a interface pode criar um commit
de sessão depois deste registro.

O [site existente](https://v0-new-project-wsxpookhu2l.vercel.app/) respondeu HTTP
200 durante a sessão. Na verificação feita antes deste encerramento, servia
`index-7e4LVZs5.js`, a versão anterior às novas telas. Não confundir site
disponível, código sincronizado e atualização publicada: são estados diferentes.

## 2. Objetivo e prioridades acordadas

Carla é muito ocupada. O compromisso esperado dela é abrir o app, ler um
briefing útil, arquivar o que não importa, aprovar uma resposta/ação já preparada
ou dar uma correção rápida. A Barbara deve receber os resultados dessas decisões
e cuidar da execução e das correções, com o mínimo de trabalho repetitivo.

- O conteúdo do briefing atual da Carla está aprovado: preservar as informações.
- A primeira correção era separar as experiências das duas pessoas.
- O robô já faz um bom trabalho de classificação e contexto. Melhorar isso não
  é prioridade agora.
- Alterações de design ficam para outra conversa.
- O objetivo posterior inclui respostas apoiadas em documentos do workspace,
  identificação do arquivo/versão correta e aprovação de envio de anexos.
- O grau de autonomia do robô e a redução da carga da Barbara serão definidos
  depois que o fluxo básico funcionar de ponta a ponta.

## 3. O que mudou no código

### Experiências separadas

- Carla mantém o briefing com Today / Upcoming / Archive e o estilo existente.
- Barbara abre **From Carla**, com aprovações e instruções ainda pendentes.
- A identidade vem da sessão pareada e de `people.who`; a escolha independente
  de papel no navegador foi retirada do fluxo.
- A camada antiga `role.js` foi removida. Ela alterava o DOM, usava outra fila,
  registrava feedback sem conteúdo e tinha botões que não abriam os lotes.

### Handoffs, feedback e revisão

| Ação | Resultado implementado |
| --- | --- |
| Carla aprova | `review: approved`, sem marcar execução concluída; entra na fila de Barbara |
| Carla envia feedback | Texto e metadados do ditado são salvos no lote, com `review: barbara` |
| Barbara corrige a proposta | A versão revisada volta para Carla, com `review: pending` |
| Barbara marca trabalho realizado como tratado | `completed: true`; sai de sua fila |
| Carla cancela o editor ou começa um ditado sem enviar | Nenhum handoff é criado |
| Uma gravação no backend falha | O editor mantém o texto para tentar novamente |
| Outra pessoa altera o lote enquanto Barbara edita | Texto local preservado; envio da versão antiga bloqueado |

- As propostas aprovadas continuam visíveis na tela da Barbara.
- A fila dela consulta os estados pertinentes diretamente, sem depender do
  limite de 200 itens do arquivo da Carla.
- Itens aguardando Barbara têm o controle de aprovação desabilitado e deixam
  de ocupar o destaque da Carla quando há outro item para revisar.
- O botão de atualizar a fila de Barbara só consulta dados; não inicia o robô.
- Navegadores sem suporte a ditado usam texto e o salvam como escrito.

### Fonte e publicação

- O código React/TypeScript original foi recuperado em
  [frontend/src](./frontend/src). Antes dos ajustes, seu build reproduziu os
  bundles originais do repositório byte por byte.
- Os caminhos dos recursos estáticos foram corrigidos. O HTML agora referencia
  arquivos que existem em [assets](./assets).
- Ao conferir o site real, foi descoberto que a versão publicada incluía um
  cliente de robô mais recente do que o pacote inicial do GitHub.
- Esse suporte foi incorporado: pedidos podem ficar em `queued` para a rotina
  agendada, em vez de chamar um robô de servidor sem configuração. Propostas
  enfileiradas não podem ser aprovadas enquanto aguardam preparação.
- A fila do robô relê o lote antes de pedir outra proposta, evitando reenfileirar
  um item já aprovado, concluído ou em processamento.
- [vercel.json](./vercel.json) e
  [scripts/stage-static.mjs](./scripts/stage-static.mjs) preparam na hospedagem o
  pacote estático já testado, com os cabeçalhos adequados. Assim o deploy não
  depende de reconstruir o frontend sem suas variáveis locais.
- Essa configuração **não conecta nem publica um projeto automaticamente**.

## 4. O que foi validado

Resultados da sessão, sem reexecutar testes durante o encerramento:

- [x] TypeScript: `npm run typecheck`.
- [x] **14 testes de lógica**: `npm test`.
- [x] Testes no navegador: `npm run test:browser`, com duas sessões autenticadas
  fictícias e armazenamento compartilhado simulado.
- [x] Aprovação da Carla, visualização e conclusão pela Barbara.
- [x] Feedback escrito e ditado, cancelamento sem gravação e falha seguida de
  nova tentativa sem perder o texto.
- [x] Proposta corrigida voltando à Carla para nova aprovação.
- [x] Aprovação antiga aparecendo para Barbara mesmo além do limite do arquivo.
- [x] Conflitos entre dispositivos preservando o rascunho e bloqueando envio antigo.
- [x] Controles de aprovação do destaque e da lista usando o mesmo fluxo.
- [x] Estado `queued` persistindo e o cliente de rotina não chamando o robô de
  servidor inativo; a fila de Barbara não chama funções do robô.
- [x] Inspeção visual em 390 × 844, sem rolagem horizontal nas telas verificadas.
- [x] Build: `npm run build:site` e `node scripts/stage-static.mjs`.
- [x] Recursos do pacote estático e hash do script de boot no CSP conferidos.

Os testes finais do navegador produziram 8 gravações esperadas **na simulação**.
Gmail, Supabase e reconhecimento de voz reais não foram acionados pelos testes.
Isso valida o frontend e suas solicitações; não comprova políticas do banco,
microfone físico, pareamento real das duas pessoas ou execução atual da rotina.

## 5. O que está parcial ou ainda não funciona como objetivo final

- **Envio de e-mails/anexos:** não implementado. O acesso Gmail atual é de
  leitura. Barbara ainda precisa agir no Gmail e depois marcar como tratado.
  Nenhum botão deve afirmar que enviou um e-mail sem confirmação real do envio.
- **Áudio:** o que funciona é ditado convertido em texto. Não há armazenamento
  nem reprodução do áudio original. Decidir depois se isso é necessário.
- **Arquivos do workspace:** busca de documentos, identificação de versões,
  preparação de anexos e confirmação de entrega não foram implementadas.
- **Autorização do servidor:** as telas e ações têm restrições por pessoa, mas
  as políticas RLS e o contrato real de `doc_merge` não foram auditados nesta
  sessão. O controle no frontend não equivale a uma autorização no servidor.
- **Concorrência no backend:** há releitura e proteção contra versões antigas no
  app, mas não foi implementada uma gravação condicional atômica no servidor.
- **Tamanho da fila:** até 1.000 itens por estado, com aviso ao atingir o limite;
  paginação completa continua pendente caso esse volume se torne relevante.
- **Identidades reais:** confirmar que cada dispositivo foi pareado como a
  pessoa correta; o antigo seletor local não altera a identidade autenticada.

## 6. Bloqueios de acesso observados

### GitHub

- Repositório: [barbaracohenguilhem/formulary](https://github.com/barbaracohenguilhem/formulary).
- Um push inicial foi recusado com HTTP 403 para `barbaracohenguilhem03`.
- A preferência de usuário Git deste repositório foi ajustada localmente para
  `barbaracohenguilhem`.
- O commit `84bee77` apareceu no remoto durante a conferência, sem atribuir seu
  envio ao comando do terminal que havia falhado.
- O push de `1792cbd` falhou porque o Git não tinha credencial utilizável para
  `barbaracohenguilhem`; prompts estavam desativados no comando automatizado.
- Próximo passo: autenticar uma conta com escrita e enviar o commit pendente,
  junto deste registro. Não forçar push nem apagar credenciais de outras contas.

### Vercel

- Projeto esperado no endereço público:
  [v0-new-project-wsxpookhu2l.vercel.app](https://v0-new-project-wsxpookhu2l.vercel.app/).
- A conexão disponível listou somente a equipe `barbaracohenguilhem-7604`, ID
  `team_11TpdsX4Z5yxI0ynO4A3a6Kw`, sem projetos.
- A consulta ao projeto nessa equipe retornou 404 / Project not found.
- Reconectar o app Vercel à conta/equipe que administra o site existente. Não
  criar um projeto substituto por suposição.
- **Ferramenta recomendada para a retomada:** instalar a CLI com
  `npm i -g vercel`, após a revisão de dependências aplicável. Ela permite usar
  `vercel env pull`, `vercel deploy` e `vercel logs`. Não está instalada e não
  foi instalada neste encerramento. A CLI também precisa de autenticação na
  conta correta; sua instalação sozinha não resolve o acesso ao projeto.

### Supabase

- Projeto referenciado pelo app: `mboycjejyokkkaddcwng`.
- A tentativa de obter os detalhes pelo conector retornou falta de permissão.
- Reestabelecer acesso de leitura à conta/projeto correto antes de afirmar que
  identidades, políticas e integração real foram verificadas.
- Não houve migração, alteração de permissões, escrita em dados de produção
  nem envio de mensagens nesta preparação.

## 7. Ordem sugerida para retomar

1. Reconsultar branch, commits e remoto; comparar também com `main`, que tem
   um histórico diferente. Preservar mudanças que tenham chegado desde hoje.
2. Resolver autenticação GitHub e sincronizar `1792cbd` e a documentação.
3. Reconectar Vercel ao projeto certo e verificar o acesso ao Supabase.
4. Preparar uma prévia e testar, com um item claramente identificado para teste,
   o ciclo real **Carla aprova → Barbara recebe → Carla pede correção → Barbara
   devolve proposta → Carla aprova novamente**, nos dispositivos das duas.
5. Conferir persistência, identidade e permissões reais antes de substituir o
   app publicado. Publicar apenas no projeto e ambiente confirmados.
6. Implementar envio real de respostas com revisão do destinatário e conteúdo,
   registro de sucesso confirmado pelo Gmail e proteção contra envio duplicado.
7. Adicionar busca de arquivos do workspace e fluxo de anexos, com versão e
   arquivo exatos visíveis na aprovação.
8. Só depois discutir mais autonomia do robô, eventual áudio original,
   refinamento de classificação e mudanças de design.

## 8. Arquivos de referência

- [README](./README.md): visão geral e comandos de desenvolvimento/build.
- [App](./frontend/src/App.tsx): separação das telas por identidade.
- [ReviewScreen](./frontend/src/screens/ReviewScreen.tsx): fila da Barbara.
- [LabelScreen](./frontend/src/screens/LabelScreen.tsx): revisão e editor de proposta.
- [SlipScreen](./frontend/src/screens/SlipScreen.tsx): feedback escrito/ditado.
- [review](./frontend/src/lib/review.ts): transições e validações do fluxo.
- [useFormulary](./frontend/src/store/useFormulary.ts): persistência, assinaturas e robô.
- [Testes de lógica](./tests/review.test.ts) e [testes no navegador](./tests/browser.mjs).
- [Build estático](./scripts/build-site.mjs) e [configuração Vercel](./vercel.json).

Este documento contém apenas contexto e identificadores operacionais. Credenciais,
tokens e conteúdo de e-mails reais não devem ser acrescentados aqui.
