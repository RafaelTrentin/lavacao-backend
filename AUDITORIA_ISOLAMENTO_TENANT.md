# Auditoria local de isolamento multiempresa — 10/11/2026

Escopo: os 81 handlers HTTP declarados nos controllers carregados pelo AppModule,
guards/decorator, DTOs, services, chamadas Prisma, relações do schema e envio de
notificações. Inclui as correções locais das etapas anteriores, ainda sem commit.
Nenhum banco, conta, serviço externo ou ambiente de produção foi consultado.

J = JwtGuard/Passport + JwtStrategy: assinatura/expiração do JWT, consulta do usuário
pelo `sub`, usuário e empresa ativos/não excluídos, tokenVersion atual. O tenant e a
role usados pelo controller vêm do banco, não dos claims de tenant/role nem do body.
A = AdminGuard após J. T = ThrottlerGuard. SFC = sem falha confirmada no caminho
auditado; não constitui garantia absoluta ou teste de penetração em produção.

## Matriz inicial (antes das correções desta auditoria)

Rotas agrupadas somente quando compartilham a mesma autorização e acesso aos dados.
`GET/POST` representa dois handlers, não um endpoint genérico.

| Rota | Guard/autorização | Origem do tenant | Filtro/checagem | Risco comprovado |
|---|---|---|---|---|
| POST /auth/signup | DTO + service | slug resolvido no banco | empresa ativa/não excluída, role CUSTOMER | SFC; correção anterior preservada |
| POST /auth/login | senha + service | slug ou ADMIN elegível único | e-mail+empresa, usuário ativo/não excluído | SFC; ambiguidade já corrigida |
| POST /auth/refresh | assinatura refresh + hash persistido | sub do refresh | validade, isRevoked; sem status/versão atual | F2 |
| POST /auth/forgot-password | resposta genérica | slug | usuário+empresa ativos/não excluídos | SFC |
| POST /auth/reset-password | segredo aleatório/SHA256 | usuário do token persistido | token válido, consumo único; usuário+empresa ativos; revoga refresh | SFC |
| GET /public/business/search | público | busca pública | empresa ativa/não excluída; projeção pública | SFC |
| GET /public/business/empresa/:slug | público | slug | empresa ativa/não excluída; projeção pública | SFC |
| GET /business | J | J | id da empresa | SFC |
| GET /business/settings, /business/branding, /business/address | J | J | relação por businessId | SFC |
| PUT /business/settings, /business/branding, /business/address | J+A | J | businessId; DTOs sem propriedade/tenant | SFC |
| POST /business/upload-logo | J+A | J | pasta Cloudinary por businessId; conteúdo validado | SFC |
| POST /business/geocode-address | J+A | não acessa registros de tenants | endereço fornecido, sem leitura Prisma | SFC |
| GET/PUT /customers/profile | J | J | perfil por userId+businessId; id+businessId no service | SFC |
| GET /customers/admin/list | J+A | J | businessId; projeção pública | SFC |
| POST /customers/admin/quick | J+A | J | user/perfil criados com tenant da sessão; DTO limitado | SFC |
| GET/POST /addresses | J | J + perfil por userId | listagem businessId+customerId+deletedAt; create com IDs do servidor | SFC |
| PUT/DELETE /addresses/:id | J | J + perfil por userId | confere tenant, dono e deletedAt antes da escrita | SFC |
| POST /appointments | J | J + perfil por userId | modalidade no tenant; endereço do cliente; dados explicitamente montados | F3 para recursos excluídos |
| POST /appointments/admin | J+A | J | customerId deve pertencer à empresa; mesma criação | F3 para recursos excluídos |
| GET /appointments | J | J + perfil por userId | businessId+customerId+deletedAt | SFC |
| GET /appointments/:id | J | J | tenant; também cliente quando não ADMIN | F3: deletedAt não conferido |
| POST /appointments/:id/cancel | J | J | tenant; cliente proprietário quando CUSTOMER | F3: deletedAt não conferido |
| POST /appointments/:id/reschedule | J | J | tenant; cliente proprietário quando não ADMIN | F3: deletedAt/serviço indisponível |
| POST /appointments/:id/start, /appointments/:id/complete | J+A | J | tenant antes de transação/histórico/notificação | F3: deletedAt não conferido |
| GET /appointments/admin/date/:date | J+A | J | businessId+deletedAt+data | SFC |
| POST /appointments/estimate-search-fee | J | J + perfil por userId | modalidade no tenant; endereço do cliente; coordenadas da própria empresa | F3: recurso indisponível/excluído |
| GET /availability/slots, /availability/validate | J | J | serviceMode.businessId; agenda e bloqueios por tenant | F3: modalidade inativa/excluída e tipo excluído |
| GET /service-modes | J | J | businessId+isActive+deletedAt | SFC |
| GET /service-modes/:id | J | J | confere tenant+deletedAt; leitura permite inativa | SFC (leitura não equivale a autorização para agendar) |
| GET/POST /admin/service-modes | J+A | J | lista/create por businessId | SFC |
| GET/PUT/DELETE /admin/service-modes/:id | J+A | J | confere tenant+deletedAt; campos explícitos | SFC |
| POST /admin/service-modes/:id/rules | J+A | J | modalidade e tipo de veículo pertencem ao tenant | SFC |
| PUT /admin/service-modes/rules/:ruleId | J+A | J | tenant+deletedAt da modalidade e tipo relacionados | SFC |
| GET /vehicle-types, /admin/vehicle-types | J; J+A no admin | J | businessId+deletedAt | SFC |
| POST /admin/vehicle-types | J+A | J | create com businessId da sessão | SFC |
| PUT/DELETE /admin/vehicle-types/:id | J+A | J | confere tenant+deletedAt; escrita explícita | SFC |
| GET /extra-services | J | J | businessId+deletedAt; somente ativos para cliente | SFC |
| POST /extra-services | J+A | J | businessId do servidor; DTO sem serviceModeId ou businessId | SFC |
| PUT/DELETE /extra-services/:id | J+A | J | tenant+deletedAt; DTO sem relações | SFC |
| POST /extra-services/requests | J | J + perfil por userId | extraService ativo/não excluído do tenant | SFC |
| GET /extra-services/requests | J+A | J | businessId; inclui cliente e serviço vinculados | SFC |
| PUT /extra-services/requests/:id/status | J+A | J | confere tenant; somente status copiado do body | SFC |
| POST /extra-services/upload-image | J+A | J | pasta por businessId; conteúdo validado | SFC |
| GET/POST /admin/schedule-blocks | J+A | J | businessId; create monta campos explícitos | SFC |
| PUT /admin/schedule-blocks/:id | J+A | J inicialmente | confere tenant, depois data=body sem DTO | F1 e F3 |
| DELETE /admin/schedule-blocks/:id | J+A | J | confere tenant, mas não deletedAt | F3 |
| GET /admin/dashboard/summary | J+A | J | todos findMany/count por businessId | SFC |
| GET /admin/dashboard/revenue-period, /admin/dashboard/distribution-by-service | J+A | J | businessId+datas+deletedAt | SFC |
| GET /admin/dashboard/vehicle-distribution, /admin/dashboard/cancelled-analysis | J+A | J | businessId+datas+deletedAt | SFC |
| GET /admin/dashboard/top-customers, /admin/dashboard/top-customers-period | J+A | J | agendamentos por businessId, inclui cliente relacionado | SFC |
| GET /notifications, /notifications/unread-count | J | J | businessId+userId | SFC |
| POST /notifications/:id/read | J | J | id+businessId+userId antes de update | SFC |
| POST /notifications/read-all | J | J | updateMany por businessId+userId | SFC |
| GET /push-notifications/public-key | J | não aplicável | somente chave pública VAPID | SFC |
| POST /push-notifications/subscribe | J | J na nova associação | upsert só por endpoint substitui tenant/dono/chaves | F4 |
| DELETE /push-notifications/unsubscribe | J | J | endpoint+businessId+userId | SFC |
| POST /push-notifications/devices/status | J | J | token+businessId+userId+isActive | SFC |
| POST /push-notifications/devices | J | J | token existente de outra conta/tenant é recusado; upsert não troca proprietário | SFC |
| DELETE /push-notifications/devices | J | J | token+businessId+userId | SFC |
| POST /push-notifications/devices/revoke | T + segredo | hash do segredo de revogação | deleteMany por hash único, resposta pública genérica | SFC; saída sem JWT intencional para logout offline |
| POST /maps/geocode-address | J | não acessa registros de tenants | endereço fornecido, chamada externa sem leitura Prisma | SFC |
| GET /uploads/* (estático, não incluído nos 81 handlers) | público | não aplicável | arquivos de imagem públicos; uploads atuais usam Cloudinary | Nenhum arquivo privado comprovado; conteúdo de produção não inspecionado |

## Falhas confirmadas e correções pontuais

- **F1 — alta, escrita cruzada:** ADMIN de A podia editar bloqueio próprio enviando
  `businessId` de B, ou operações relacionais Prisma no campo `business`. A checagem
  anterior de propriedade não protegia a escrita posterior. DTO de atualização,
  campos explicitamente permitidos na service e tenant também no WHERE da escrita.
- **F2 — média, renovação indevida:** refresh não revalidava disponibilidade e versão.
  A rota emitia tokens mesmo com usuário/empresa desativados/excluídos. O JwtStrategy
  ainda barrava uso desses tokens enquanto desativados: não se afirma que o refresh
  sozinho expunha dados nessa condição. Agora confere status, versão e empresa do
  usuário antes de consumir/emitir tokens. Versão ausente continua equivalente a zero.
- **F3 — média, acesso a registros indisponíveis:** operações por ID ignoravam
  deletedAt de agendamentos/bloqueios; criação/estimativa ignoravam endereço excluído;
  regras de disponibilidade/estimativa permitiam modalidades inativas/excluídas e
  tipos excluídos. Adicionadas checagens locais. Relação de tipo de veículo também
  explicitamente limitada ao tenant nas consultas operacionais. Não altera histórico
  de agendamentos que legitimamente referencia modalidades posteriormente desativadas.
- **F4 — média, integridade de Web Push:** conhecendo endpoint alheio, um usuário
  podia substituir sua associação e as chaves por valores arbitrários, prejudicando
  a entrega. Não foi demonstrada descriptografia/interceptação de mensagens. Upsert
  agora exige mesmo proprietário ou as duas chaves atuais da inscrição. A condição
  está no WHERE do upsert; a unicidade do endpoint impede recriar a inscrição alheia
  quando a condição não corresponde. Conflito tem resposta genérica.
  O mesmo navegador pode continuar trocando de conta com sua inscrição existente.
  DTO aceita também expirationTime enviado por PushSubscription.toJSON().
- **F5 — média, destinatário indisponível:** envio interno de push filtrava tenant/dono
  do dispositivo, mas não o estado atual do usuário/empresa. Agora consulta elegibilidade
  antes de buscar destinos e enviar. Notificações históricas no banco são preservadas.

## Caminhos internos e limites

- PrismaService não instala filtro automático. Não foram encontrados RLS/policies nas
  migrações locais, nem raw SQL/middleware/extensões de tenant no src. Isso não comprova
  o estado do PostgreSQL de produção, que não foi consultado.
- FKs relacionam IDs individuais; não impõem igualdade de businessId entre relações.
  Os caminhos HTTP de criação auditados montam/validam essas relações. Dados inconsistentes
  introduzidos fora da API exigiriam auditoria separada e autorizada; não se presumiu
  que existam nem se executou correção de dados.
- UsersService (findById/findByEmail/getUsersByBusiness) não possui controller nem
  consumidor no código atual. Métodos createBusiness/getAllBusinesses/activateBusiness/
  deactivateBusiness também não possuem rota/consumidor. Não classificados como
  exposição HTTP, nem transformados em novos endpoints.
- createForUser e sendToUser são chamados internamente após autorização do agendamento;
  admins destinatários são selecionados na mesma empresa. Histórico usa appointmentId
  previamente autorizado. Não há endpoint público para envio arbitrário.
- Consultas por ID que conferem propriedade antes de retornar/escrever não foram
  classificadas como vazamento só por usarem findUnique antes da comparação.
- Leituras administrativas de clientes históricos/inativos da própria empresa não
  equivalem a login desses clientes. O guard já rejeita credenciais de usuários
  indisponíveis; não se alterou a regra de atendimento presencial do administrador.
- Escopo de correção backend: sem schema, migração, RLS, filtro global, novos endpoints,
  dados reais ou publicação. Testes usam banco simulado, JWTs locais e integrações falsas.

## Validação

- Resultado final: `npm test -- --runInBand` — 6 suítes, 144 testes aprovados
  (78 adicionados nesta auditoria). `npm run build` e `git diff --check` aprovados.
- Inventário automatizado confere os 81 handlers; os privados são exercitados com
  ausência de JWT, usuário inativo/excluído, empresa inativa/excluída e versão antiga.
  Todos os handlers administrativos rejeitam role ADMIN declarada em JWT de cliente,
  pois a role efetiva vem do banco. JWTs dos testes são assinados com segredo local.
- Testes negativos de IDs de outra empresa e de outro cliente da mesma empresa;
  corpo com businessId/relações/IDs arbitrários; recursos excluídos; dispositivo
  alheio; tomada de inscrição Web Push; refresh indisponível ou de tenant divergente.
- Casos válidos preservados: edição de bloqueio, refresh (inclusive versão zero
  legada), lookup público, revogação por segredo sem JWT e reassociação Web Push
  do mesmo navegador usando suas chaves. Suíte anterior de login/cadastro preservada.
- Não houve integração com PostgreSQL real, entrega FCM/Web Push real ou teste
  de concorrência em banco. Essas propriedades não são afirmadas como validadas
  em produção a partir dos doubles de Prisma.
