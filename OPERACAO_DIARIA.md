# Operação diária e atendimento presencial — 18/11/2026

Implementação local, sobre Appointment/Availability e os boxes já preparados. Nenhum envio ao GitHub, deploy, AAB ou acesso a dados reais.

## Interface e uso

Menu administrativo **Operação**, rota `/admin/operations`, com colunas Agendado, Aguardando, Em atendimento, Finalizado e Cancelado/ausente. Cards exibem cliente, tipo/identificação do veículo, serviço, duração, reserva, box, origem, estimativa de conclusão, atrasos, tempo decorrido e histórico recente. Grid responsivo para celular/tablet/desktop, sem drag-and-drop que possa contornar validações.

Atualização a cada 15 segundos enquanto o painel está visível, ao recuperar foco e após ações. Chave de cache inclui empresa/usuário; usa os interceptadores e limpeza de sessão existentes. Em falha de atualização, avisa sobre dados desatualizados e bloqueia ações dos cards até atualizar. Os tempos usam o relógio devolvido pelo servidor e a exibição usa o timezone IANA da empresa.

O dashboard possui um resumo da operação e link para o painel. Walk-ins usam a mesma tabela, snapshots de preço e status; portanto integram as consultas/indicadores existentes sem um segundo registro financeiro. Os indicadores financeiros anteriores não foram reformulados.

No presencial, escolha cliente existente ou faça o **cadastro rápido existente**, em etapa separada. O cliente salvo permanece cadastrado mesmo se a reserva falhar por falta de capacidade. Escolha modalidade/tipo de veículo e, opcionalmente, descreva placa/modelo/cor. O servidor define a hora atual e o box. A entrada registra a chegada como aguardando; o início é uma ação explícita.

O formulário reutiliza a mesma chave UUID ao repetir uma confirmação com resultado de rede incerto. A unicidade é por empresa. Uma repetição idêntica retorna o atendimento anterior sem novo histórico, reserva ou notificação. Para dados diferentes, é preciso uma nova tentativa; a tela orienta conferir antes o painel. A chave permanece no formulário, não há promessa de retentativa persistente após fechar/recarregar a página. Não usar o cadastro rápido como etapa automática de cada repetição.

## Estados, origem e histórico

Não adicionamos estados ao enum existente:
- CONFIRMED sem arrivedAt: Agendado.
- CONFIRMED com arrivedAt: Aguardando.
- IN_PROGRESS: Em atendimento; startedAt captura o início real.
- COMPLETED: Finalizado, usando completedAt existente.
- CANCELLED e NO_SHOW: encerrados.

Chegada só em CONFIRMED; repetição não duplica histórico. Início somente em CONFIRMED, conclusão somente em IN_PROGRESS. Iniciar diretamente também registra chegada, preservando o fluxo anterior de um clique. Administrador pode cancelar CONFIRMED ou IN_PROGRESS; cliente continua limitado à regra anterior de cancelamento. Não comparecimento exige CONFIRMED, horário já iniciado e ausência de chegada; repetição não duplica evento. Reagendamento utiliza os métodos existentes, revalida/realoja e limpa a chegada da reserva anterior. Não há restauração automática de cancelados.

Histórico existente recebe as transições e um evento CONFIRMED→CONFIRMED para chegada. Origem dos registros novos: APP no endpoint cliente, ADMIN no administrativo e WALK_IN na rota presencial. Origem/tempo/box/tenant não são aceitos no DTO do presencial. Históricos antigos mantêm origem nula (interface: Registro anterior) e não recebem horários fictícios.

## Capacidade e atrasos

Walk-in reutiliza createAppointment e o mesmo bloqueio transacional por Business. A única exceção de horário é a antecedência mínima: a entrada imediata usa o instante capturado no servidor após adquirir o lock. Continua exigindo funcionamento, duração válida, ausência de fechamento/bloqueios e box compatível disponível para todo o serviço. Não há fila presencial sem reserva quando a capacidade está esgotada.

O início real revalida o box já reservado para todo o período `agora + duração`, excluindo a própria reserva. Não desloca outras reservas nem troca de box silenciosamente. Um início atrasado que conflite com uma reserva seguinte é recusado; o administrador deve resolver o conflito pela agenda existente.

A disponibilidade considera a união da reserva original com o período operacional estimado. Veículo com chegada/início real registrado, em atendimento ou aguardando com reserva vencida mantém o box indisponível para novas reservas até ser concluído, cancelado ou reagendado quando permitido. Essa é uma proteção conservadora: não se presume que um veículo saiu porque acabou a estimativa. Reservas futuras já existentes não são movidas/canceladas; o início delas também é revalidado. A desativação do box não pode abandonar um veículo aguardando com prazo vencido.

O painel inclui aguardando/em atendimento de dias anteriores e conclusões do dia local. O relógio de tempo decorrido para em completedAt/cancelledAt. Previsões não representam confirmação de conclusão.

## Contratos e notificações

Novas rotas, todas JwtGuard + AdminGuard:
- GET `/appointments/admin/operations`: projeção explícita, sem hashes/tokens/chave de idempotência, tenant do usuário autenticado.
- POST `/appointments/admin/walk-in`: customerId, serviceModeId, vehicleType, requestKey UUID e vehicleDescription opcional. Cliente deve estar ativo e pertencer à mesma empresa.
- POST `/appointments/:id/arrive` e POST `/appointments/:id/no-show`.

Início, conclusão, cancelamento e reagendamento reutilizam os endpoints/métodos existentes. Chegada e não comparecimento geram somente histórico. Cadastro walk-in não gera o aviso indevido “Um cliente realizou um agendamento” para administradores. Início/conclusão/cancelamento preservam os avisos existentes: evento interno transacional e entrega externa após commit. Retentativas de criação não reenviam notificações.

## Migração e publicação futura

`prisma/migrations/20261118010000_operations/migration.sql` adiciona enum de origem, campos opcionais e índice único composto de idempotência. Sem UPDATE/DELETE/backfill de agendamentos. Depende da migração local anterior de boxes (`20261118000000_wash_boxes`).

Somente após autorização: revisar backup/locks de DDL, aplicar migrações em ordem, gerar client/build e atualizar todas as instâncias backend antes do frontend. Manter agenda com capacidade única onde boxes ainda não foram configurados. Android antigo mantém estados/contratos anteriores, mas só terá o novo painel após atualização de seus assets em uma futura AAB. Não foi gerada nem sincronizada nesta tarefa.

## Testes e resultado

- 288 testes unitários/HTTP backend aprovados, incluindo DTOs e autorização das novas rotas (inventário HTTP ajustado de 82 para 86 rotas nos controllers auditados).
- 62 testes PostgreSQL reais aprovados: walk-in com cliente existente/rápido, duas conexões disputando capacidade, idempotência concorrente, bloqueios/funcionamento, transições, atrasos, legado, virada de dia IANA, isolamento, notificações e regressões de boxes.
- 64 testes frontend aprovados, incluindo ações, formulário, repetição com mesma chave, cadastro rápido, tempos e atualização automática.
- TypeScript frontend e builds Vite/Nest aprovados; dist/main.js presente. Avisos conhecidos do Vite (bundle/Browserslist) e React Router mantidos.
- Testes de escrita executados somente por `npm run test:concurrency`, que confirma `127.0.0.1:55439/washsync_concurrency_test`, cria PostgreSQL descartável e aplica as 13 migrações antes dos testes. Container removido ao terminar. E-mail/push externos simulados; nenhuma conta real.

## Arquivos desta etapa

Backend: `prisma/schema.prisma`, migração `20261118010000_operations/migration.sql`, `src/modules/appointments/{appointments.controller.ts,appointments.service.ts,dto/walk-in.dto.ts,operations-contract.spec.ts}`, `src/modules/availability/availability.service.ts`, `src/modules/wash-boxes/wash-boxes.service.ts`, `src/{appointments-concurrency.integration.spec.ts,appointment-time-policy.spec.ts,tenant-isolation.spec.ts}`, este documento e atualização de `MULTIPLOS_BOXES.md`.

Frontend: `src/pages/admin/{AdminOperationsPage.tsx,AdminDashboard.tsx}`, `src/components/admin/{WalkInForm.tsx,OperationsSummary.tsx}`, `src/hooks/useOperations.ts`, `src/lib/{api.ts,operations.ts}`, `src/components/layouts/AdminLayout.tsx`, `src/App.tsx`, `src/test/operations.test.tsx`.

As alterações de boxes da etapa anterior permanecem locais e não foram revertidas. Pendência externa: revisão visual pelo responsável e autorização explícita para qualquer futura migração/publicação. Não há nova infraestrutura externa necessária.

## Compatibilidade aprovada para publicação

Registros anteriores sem arrivedAt e startedAt preservam apenas a ocupação do período reservado, inclusive quando ainda marcados IN_PROGRESS. Não são encerrados nem reescritos. A retenção por atraso depende de presença registrada pelo novo fluxo. Decisão aprovada pelo responsável para não bloquear a agenda com registros históricos pendentes.
