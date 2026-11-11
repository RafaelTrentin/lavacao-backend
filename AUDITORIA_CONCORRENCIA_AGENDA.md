# Concorrência da agenda — 11/11/2026

> Continuação: a etapa de timezone em `AUDITORIA_TIMEZONE_AGENDA.md` unificou a
> política temporal e tratou a projeção de recorrência apontada abaixo. Este documento
> preserva os resultados e limites observados na etapa original de concorrência.

## Reprodução real antes da correção

Base analisada: `57219c2`. PostgreSQL 16 em container descartável, publicado
somente em `127.0.0.1:55439`, banco `washsync_concurrency_test`.
Schema gerado do Prisma local, sem seeds da aplicação e sem copiar dados reais.
Services reais, conexões Prisma independentes; mapas, notificações e push isolados.
Uma pausa de 150 ms antes da escrita amplia a janela de interleaving sem substituir
leituras, transações, inserts ou updates do PostgreSQL.

Três testes inicialmente falharam: duas criações, dois reagendamentos de admin e
dois reagendamentos de clientes. Em cada caso as duas chamadas retornaram sucesso
e gravaram agendamentos confirmados no mesmo intervalo 12:00–12:40.
Não se trata apenas de inferência pela leitura do código.

## Modelo e decisão

- A capacidade implementada é uma agenda única por empresa, sem boxes/funcionários
  ou paralelismo por modalidade. CONFIRMED e IN_PROGRESS ocupam capacidade.
- A duração vem da regra da modalidade na criação e do snapshot no reagendamento.
- Intervalos são semiabertos: início igual ao fim de outro serviço é permitido.
- O schema/migrations têm índices de consulta e unicidade do número de reserva,
  mas nenhuma exclusão de intervalos. Uma chave única por início ou por slot
  não garantiria serviços de 20, 40, 90 minutos etc.
- Foi escolhido bloqueio transacional da linha Business com `FOR NO KEY UPDATE`,
  SQL parametrizado e isolamento explícito READ COMMITTED. Após esperar o lock,
  as leituras enxergam o commit do escritor anterior. O lock termina no commit
  ou rollback e funciona entre processos/instâncias; empresas distintas usam
  linhas distintas. Não há lock global em memória ou migração.
- SERIALIZABLE com retry seria possível, mas exigiria repetir toda a validação
  transacional e tratar abortos. O lock por empresa é proporcional à capacidade
  única já existente e evita esses retries no fluxo normal.

Referência: [PostgreSQL — explicit locking](https://www.postgresql.org/docs/16/explicit-locking.html).

## Alterações

- `schedule-transaction.ts`: coordenação compartilhada, empresa ativa/não excluída,
  espera por conexão e transação limitadas a 10 segundos.
- `AppointmentsService`: criar, reagendar (cliente/admin), cancelar, iniciar e
  concluir usam a coordenação. Propriedade/status são relidos dentro da transação.
  A validação e a gravação de capacidade pertencem à mesma transação.
- `AvailabilityService`: aceita o cliente transacional, exclusão do próprio
  agendamento e duração persistida; consulta sobreposições pelo intervalo completo.
  Valida o instante efetivamente gravado, sem reinterpretá-lo no fuso do servidor.
  Evita conversão dupla de datas locais e compara antecedência com o instante atual.
  A exploração de horários continua em passos de 15 minutos, sem arredondar durações.
- `ScheduleBlocksService`: criar, atualizar e excluir bloqueios usam o mesmo lock.
  Um bloqueio que terminou antes da reserva obter o lock passa a ser visto por ela.
- Notificações de mudanças de agendamento acontecem após commit. Falha de transporte
  é registrada, sem desfazer ou apresentar como falha a operação já confirmada.
- Testes de isolamento existentes recebem doubles de transação/lock; não substituem
  os testes de concorrência, que usam PostgreSQL real.

## Validação e reprodução

Com Docker em execução e Node/dependências disponíveis:

```sh
npm run test:concurrency
npm test -- --runInBand
npm run build
```

O primeiro comando cria seu próprio container PostgreSQL 16, gera o schema a partir
do Prisma local, executa os testes e remove o container. Recusa conflito de nome/porta,
não reutiliza banco existente e não usa DATABASE_URL como fallback. A suíte de
integração também recusa hosts, portas ou nomes de banco diferentes dos dedicados.
As variáveis definidas pelo runner existem só no processo; nenhum .env é alterado.

Resultado: **20 testes PostgreSQL passaram**, incluindo criação simultânea,
reagendamentos simultâneos de cliente/admin, criação contra reagendamento,
sobreposição parcial, intervalos adjacentes, snapshot de duração, cancelamento
contra início, status que liberam capacidade, bloqueio confirmado durante espera,
rollback por FK inválida sem notificações, fuso horário e empresas independentes.
A suíte comum executa os 144 testes anteriores; os 20 testes PostgreSQL ficam
explicitamente skipped nesse comando sem a configuração local dedicada.
Build do backend aprovado. Nenhum contrato HTTP exige mudança de Android/frontend.

## Limites e cuidados para publicação futura

- Todas as instâncias que gravam agenda devem executar esta versão. Um processo
  antigo ou SQL externo que ignore o lock pode violar a garantia; fazer drenagem
  das requisições/instâncias antigas na publicação. Não foi publicado nesta tarefa.
- O lock serializa gravações de uma mesma empresa inclusive em datas diferentes.
  Monitorar espera e timeouts sob carga; os testes não são um benchmark de produção.
  Um timeout aborta a transação; não há retry automático que repita notificações.
- Não repara sobreposições históricas. Qualquer saneamento exige levantamento e
  autorização próprios, sem atualização automática de registros reais.
- Criar um bloqueio após uma reserva continua sem cancelar/rejeitar reservas já
  existentes, conforme comportamento anterior. A coordenação estabelece uma ordem
  de gravação, não muda essa decisão de produto.
- Não houve redesenho de recorrência dos bloqueios ou das configurações de operação.
  A projeção de bloqueios recorrentes para datas futuras permanece uma limitação
  a auditar separadamente: o código atual filtra dias da semana, mas usa startAt/endAt
  originais. Os testes de bloqueio desta tarefa cobrem intervalos concretos.
- Notificações externas não são transacionais com PostgreSQL; não há garantia de
  entrega exatamente uma vez/outbox nesta alteração. Nenhum envio real foi efetuado.
- Nenhuma migração, acesso a banco de produção, mudança Android, AAB, commit ou push.
