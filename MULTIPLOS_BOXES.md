# Boxes e capacidade simultânea — implementação local

## Comportamento

- Sem configuração, a empresa conserva uma vaga virtual, com a disponibilidade anterior.
- O primeiro box cadastrado representa a vaga original (`isLegacyDefault`). Agendamentos sem `boxId` ocupam esse box por interpretação, sem backfill ou UPDATE de registros antigos. Cadastrar o segundo box aumenta a capacidade.
- Cada atendimento novo recebe um box compatível, ativo e livre durante TODO o intervalo `[início, fim)`. Intervalos adjacentes são permitidos. Nunca combinamos pedaços de vagas diferentes para comportar um serviço.
- A alocação é automática; o cliente continua escolhendo serviço, veículo e horário. Boxes especializados são preferidos aos irrestritos, com desempate estável. Não redistribuímos reservas existentes para otimizar encaixes.
- `serviceModeIds=[]` significa todos os serviços. IDs são validados no backend contra modalidades ativas da empresa. A lista é uma coluna PostgreSQL; não há exclusão física de serviços por essa funcionalidade.
- Agenda e validação autoritativa evoluem o mesmo `AvailabilityService`. Passos de exploração de 15 minutos, timezone IANA, antecedência, funcionamento, férias e recorrências são preservados. Bloqueios existentes fecham TODOS os boxes; não criamos uma segunda agenda.
- Cancelamento, conclusão e não comparecimento liberam capacidade. CONFIRMED e IN_PROGRESS ocupam o intervalo reservado. A evolução operacional posterior também considera início real/estimativa e retém capacidade vencida de veículos presentes até resolução explícita; consulte `OPERACAO_DIARIA.md`.
- Reagendamento real realoca o recurso na transação. A duração salva no agendamento é preservada; editar uma regra de serviço afeta novas reservas, não altera horários/durações históricos. Não foi criado endpoint de alteração avulsa da duração de um atendimento.
- Desativação/restrição é recusada quando incompatível com reservas futuras ou atendimentos em andamento do box, incluindo reservas antigas da vaga original. O administrador precisa reagendar/cancelar antes. Nenhuma alteração cancela reservas automaticamente.
- Não há exclusão de boxes, mantendo referências e snapshots. Renomear não altera o nome gravado nos snapshots anteriores.

## Isolamento e concorrência

`GET/POST /admin/wash-boxes` e `PUT /admin/wash-boxes/:id` usam JwtGuard + AdminGuard, tenant exclusivamente do usuário autenticado e DTOs com lista positiva. `businessId`, `isLegacyDefault`, IDs internos e timestamps não são campos de entrada. Respostas de boxes usam select explícito.

Configuração de boxes, reservas, reagendamentos, cancelamentos e bloqueios usam o mesmo bloqueio da linha Business (`FOR NO KEY UPDATE`, READ COMMITTED). Após adquirir o lock, consultam ocupação/capacidade e só então gravam. Empresas diferentes não disputam a mesma linha. Não adicionamos fila, middleware Prisma ou exclusão global de intervalos que impediria vários boxes.

A FK composta `Appointment(boxId,businessId) → WashBox(id,businessId)` impede vínculo cruzado mesmo no banco. A ausência de sobreposição depende de todos os escritores usarem o protocolo transacional da aplicação; SQL externo que reserve recursos diretamente não está autorizado nem protegido por uma constraint temporal nesta solução.

## Persistência e atualização futura (NÃO executada em produção)

Migração: `prisma/migrations/20261118000000_wash_boxes/migration.sql`.
Adiciona WashBox, dois campos opcionais em Appointment, índices e FKs. Não contém UPDATE, DELETE, alteração de enum ou mudança de horário/preço/dados históricos.

Ordem para uma futura publicação, somente após autorização:
1. Revisar backup, estado das migrações e janela de DDL (ADD COLUMN/índices/FK adquirem locks; validar volume antes da execução real).
2. Aplicar a migração aditiva antes de subir o novo backend; gerar Prisma Client e compilar.
3. Atualizar todas as instâncias backend antes de habilitar vários boxes. Enquanto nada for cadastrado, a capacidade continua sendo uma vaga. Não exige seed ou configuração em massa.
4. Publicar frontend. O administrador cadastra primeiro a vaga original e depois as adicionais, com suas restrições.
5. Para disponibilizar a gestão/visão de boxes no Android, gerar uma nova versão com o frontend atualizado quando autorizado. Nenhum arquivo Android foi alterado/sincronizado nesta tarefa.

Contratos anteriores de criação/reagendamento não exigem boxId; o servidor decide. O array legado de slots é preservado. `boxId` e `snapshotBoxName` são campos aditivos. Clientes antigos continuam sujeitos à capacidade do servidor, mas não possuem a nova interface administrativa. Mantém-se a limitação já conhecida de Android antigo com offset fixo fora de São Paulo.

Rollback do código deve manter tabela/colunas e suspender novas configurações; o backend anterior interpreta uma capacidade global e pode recusar novas reservas em uma agenda com múltiplos boxes. Não remover colunas nem reescrever agendamentos para reverter.

## Validação isolada

`npm run test:concurrency` cria um container PostgreSQL 16 descartável, publicado somente em `127.0.0.1:55439`, banco `washsync_concurrency_test`. Sobrescreve DATABASE_URL e WASHSYNC_CONCURRENCY_TEST_URL, verifica o destino, aplica a cadeia real de migrações e executa testes com fixtures fictícias. Recusa reaproveitar container/porta existentes e remove somente o container que criou. Os testes também recusam URLs diferentes e nunca usam DATABASE_URL como fallback. Integrações externas/notificações são simuladas.

Testes cobrem capacidade única/dupla, corrida de criação e reagendamento, durações variáveis, fragmentação entre boxes, legado sem reescrita, serviços permitidos, desativação concorrente, configuração inicial concorrente, cancelamento, bloqueios globais, FK/IDs entre empresas, fusos IANA e repetição de hora no horário de verão. Contratos HTTP testam autorização, tenant confiável, campos protegidos e payload inválido. Frontend testa criação/edição/desativação, conflito do servidor e ocupação de reservas antigas/novas no fuso da empresa.

Nenhuma alteração foi enviada ao GitHub, implantada, aplicada em produção ou publicada no Android.

### Resultado local em 18/11/2026

- 277 testes unitários/contratos HTTP do backend aprovados.
- 48 testes de integração/concorrência PostgreSQL aprovados; cadeia de 12 migrações aplicada somente no container descartável.
- 56 testes frontend aprovados, TypeScript sem erros e build Vite aprovado.
- Schema Prisma validado, client gerado localmente e build Nest aprovado com `dist/main.js` presente.
- Avisos preexistentes do frontend: Browserslist desatualizado, bundle acima de 500 kB e avisos de futura versão React Router nos testes.

### Arquivos desta evolução

Backend: `prisma/schema.prisma`, `prisma/migrations/20261118000000_wash_boxes/migration.sql`, `scripts/test-concurrency.cjs`, `src/app.module.ts`, `src/modules/appointments/appointments.service.ts`, `src/modules/availability/availability.service.ts`, `src/modules/wash-boxes/{wash-box.dto.ts,wash-boxes.controller.ts,wash-boxes.service.ts,wash-boxes.module.ts,wash-boxes.spec.ts}`, `src/appointments-concurrency.integration.spec.ts`, `src/appointment-time-policy.spec.ts`, `src/search-fee-characterization.spec.ts` e este documento.

Frontend: `src/lib/api.ts`, `src/types/index.ts`, `src/components/admin/{WashBoxes.tsx,BoxOccupancy.tsx}`, `src/pages/admin/{AdminSettingsPage.tsx,AdminSchedulePage.tsx}`, `src/test/wash-boxes.test.tsx`.

`WASHSYNC_CONTEXTO_TECNICO.md` já era um arquivo local não rastreado e foi preservado.
