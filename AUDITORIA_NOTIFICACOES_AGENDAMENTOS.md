# Notificações dos atendimentos

## Constatação e decisão

Na base local recebida para esta etapa (incluindo as correções anteriores de concorrência), todos os seis caminhos já enviavam push depois de `withScheduleTransaction`. Entretanto, também criavam a notificação interna depois do commit e aguardavam a rede na resposta HTTP. Não se confirmou envio externo dentro da transação nesta versão local.

| Operação | Destinatário | Evento interno | Entrega externa |
|---|---|---|---|
| Criação | ADMINs ativos e não excluídos da empresa | GENERAL | Web Push e FCM |
| Cancelamento | Usuário do cliente proprietário | APPOINTMENT_CANCELLED | Web Push e FCM |
| Reagendamento administrativo | Usuário do cliente proprietário | APPOINTMENT_RESCHEDULED | Web Push e FCM |
| Reagendamento do cliente | Usuário do cliente proprietário | APPOINTMENT_RESCHEDULED | Web Push e FCM |
| Início | Usuário do cliente proprietário | APPOINTMENT_STARTED | Web Push e FCM |
| Conclusão | Usuário do cliente proprietário | GENERAL | Web Push e FCM |

Agora operação, histórico e Notification são gravados na mesma transação. Falha em qualquer gravação impede o commit e não dispara push. Depois do commit, o despacho assíncrono tenta entregar sem manter a transação aberta e sem aguardar a rede para responder ao HTTP. Falhas não desfazem a operação. Textos, tipos e rota `/notifications` foram preservados.

O destinatário interno precisa pertencer à empresa. A seleção de administradores é feita dentro da transação. O transporte existente continua verificando empresa e usuário ativos/não excluídos e restringindo inscrições e dispositivos por usuário/empresa.

## Retentativas, ordem e limites

- O bloqueio por empresa e as verificações de status existentes impedem repetição de cancelamento, início e conclusão. Reagendar novamente para o mesmo instante já confirmado é um no-op: mantém resposta, sem novo histórico/evento/push. Criação concorrente no mesmo intervalo continua protegida pela disponibilidade dentro do bloqueio.
- Antes de iniciar o envio, o dispatcher consulta o estado confirmado do atendimento (empresa, status, horário e datas de transição). Avisos já superados são descartados somente no push; o histórico interno permanece.
- Não há retry automático de envio, pois uma falha de rede pode acontecer depois de o provedor aceitar a mensagem. A entrega simultânea por Web Push e FCM continua sendo o comportamento existente, por inscrição/dispositivo.
- Isto não garante exatamente uma entrega nem ordem de chegada nos dispositivos: um envio já em andamento pode chegar depois de outro. Também não oferece idempotência genérica de requisições que intercalem outras transições.
- Queda do processo entre commit e envio pode perder o push, mas não a notificação interna. Outbox persistente seria necessário se o produto exigir recuperação automática dessa janela. Exigiria estado persistente de entrega, processamento e política de retentativas/deduplicação, com projeto e autorização próprios. Não foi criado outbox, fila, infraestrutura ou migração nesta etapa.
- O transporte existente tenta Web Push antes de FCM. Lentidão de Web Push ainda pode atrasar FCM, porém não a resposta nem o commit do atendimento.

## Validação

Testes reais no PostgreSQL descartável local cobrem evento visível antes do envio, rollback depois da inserção do evento, falha/lentidão do provedor, repetição concorrente, reagendamento repetido, ordem de status, cancelamento, conclusão e descarte de aviso obsoleto. Testes de transporte usam provedores simulados, sem envios reais. Testes existentes mantêm cobertura de destinatários inativos e isolamento multiempresa.

Resultado local: 233 testes da suíte normal aprovados; 28 testes de integração aprovados separadamente em PostgreSQL descartável; `npm run build` aprovado. Os 28 testes de integração ficam intencionalmente ignorados na suíte normal quando a URL local dedicada não está definida.

Sem alteração de schema, dados reais, contratos HTTP, frontend ou Android nesta etapa. Não requer nova AAB para esta correção de backend.
