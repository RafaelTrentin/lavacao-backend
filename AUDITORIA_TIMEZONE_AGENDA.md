# Datas, timezone e validação da agenda — 11/11/2026

## Política adotada

- `scheduledStartAt`, `scheduledEndAt`, `startAt` e `endAt` representam instantes UTC.
  O schema Prisma/PostgreSQL existente foi preservado: DateTime/TIMESTAMP(3), com
  convenção UTC na aplicação. Nenhuma conversão SQL ou migração foi aplicada.
- Entradas de instantes exigem ISO com `Z` ou offset explícito. Um horário sem offset
  não pode depender do timezone do processo. Datas impossíveis também são rejeitadas.
- Datas de consulta `YYYY-MM-DD` e horários de funcionamento `HH:mm` são valores civis
  da empresa, interpretados exclusivamente por `Business.timezone` (IANA).
- Usa-se `Intl`/tzdata do runtime, sem offset fixo e sem depender de `process.env.TZ`.
  `America/Sao_Paulo` permanece o default já existente quando o timezone não foi informado.
  Valores inválidos falham explicitamente; não são substituídos por outro fuso.
- `recurringEndDate` é metadado de data civil inclusiva, mantido na convenção legada
  de meia-noite UTC. Não é reinterpretado como instante local, o que anteciparia um dia
  em fusos negativos. Não houve regravação dos metadados existentes.

## Mapa das conversões

| Caminho | Antes | Agora |
|---|---|---|
| NewAppointmentPage: calendário | Hoje no fuso do dispositivo | Hoje civil no fuso da empresa; Date do calendário é apenas portador de ano/mês/dia |
| NewAppointmentPage: confirmação | Data + HH:mm + `-03:00` | Envia `scheduledStartAt` UTC retornado no slot |
| AdminSchedulePage: criação/reagendamento | Mesmo offset fixo | Mesmo instante UTC fornecido pela API, sem reconstrução |
| AdminSchedulePage: dia inicial e abertura do reagendamento | `new Date` e formatação no fuso do dispositivo | Converte o instante para a data civil da empresa antes de preencher o calendário |
| Agenda administrativa e Meus Agendamentos: exibição | `date-fns/format` no fuso do dispositivo | `Intl.DateTimeFormat` com timezone explícito da empresa |
| AvailabilityController | Data civil transformada em meio-dia UTC | Preserva e valida a string de data civil |
| AvailabilityService: funcionamento | Mistura de Date local, UTC e conversões de timezone | Limites civis resolvidos em instantes UTC; comparação entre instantes |
| AvailabilityService: antecedência | Só listagem; `0` virava 15 por `||` | Listagem e escrita usam a mesma regra; `0` é preservado, negativos não são aceitos |
| AppointmentsService: entrada | `new Date` aceitava horário sem offset | Parser exige instante explícito e válido |
| AppointmentsService: consulta administrativa por dia | `setHours` no fuso do processo | Intervalo UTC entre início do dia civil e início do próximo dia da empresa, fim exclusivo |
| AppointmentsService: mensagens de reagendamento | `getHours/getDate` do processo | Data/hora no timezone da empresa, capturado na transação |
| ScheduleBlocksService: criação | `new Date(blockDate)` + `setHours` do processo | Data e HH:mm resolvidos pelo timezone da empresa dentro da transação |
| Bloqueio FULL_DAY | Limites de 24 horas do processo | Início do dia civil até início do próximo: pode ter 23/25 horas |
| Bloqueio recorrente | Usava instantes da data original mesmo em outro dia | Projeta os horários locais na ocorrência consultada; considera dia anterior para intervalo que atravesse a data |
| Atualização de bloqueio | Strings de data repassadas ao Prisma | Instantes com offset obrigatório e validação de fim posterior ao início |

O endpoint autenticado `/business` já fornece o timezone da empresa do usuário.
O novo hook de frontend consulta esse contexto usando chave com businessId e userId,
sem aceitar uma empresa enviada pelo cliente como autoridade.

## Validação na escrita e regras administrativas

Criação e os dois reagendamentos (cliente/admin) validam, **dentro da transação com
o bloqueio por empresa introduzido na etapa anterior**:

1. Modalidade/regra válida para a empresa/veículo.
2. Instante não passado e antecedência mínima satisfeita no momento da validação.
3. Duração inteira dentro de um período de funcionamento e fora de data fechada.
4. Ausência de sobreposição com bloqueios ativos e agendamentos CONFIRMED/IN_PROGRESS.
5. Duração original no reagendamento e exclusão do próprio agendamento na consulta.

Não foi encontrado bypass administrativo intencional: o controller admin chama o
mesmo método de criação e as telas consultam os mesmos slots. Portanto **admin também
obedece passado e antecedência**. Não foi criado cadastro retroativo nem exceção nova.
Os campos de prazo de cancelamento/reagendamento não foram redesenhados nesta tarefa.

## Horário de verão e madrugada

- Uma hora local inexistente não é normalizada silenciosamente. Bloqueios manuais
  com limite inexistente ou ambíguo retornam 400 para escolha explícita de outro horário.
- Os slots são explorados como instantes, em passos de 15 minutos. A hora ausente no
  avanço do relógio não aparece; na volta, as duas ocorrências têm UTC e chave distintos.
  Labels de horários repetidos incluem o offset para diferenciá-las.
- A validação legada somente por data/HH:mm retorna false para hora ambígua. Criação
  com instante explícito consegue distinguir as duas ocorrências corretamente.
- Se um limite de funcionamento cair em hora inexistente, o período não é oferecido.
  Se um bloqueio **recorrente** encontrar esse problema em uma data futura, a política
  conservadora bloqueia o dia inteiro em vez de liberar a agenda silenciosamente.
  Isso exige revisar o bloqueio para liberar parte daquele dia, se desejado.
- Madrugada é suportada como período do próprio dia (por exemplo 00:00–04:00).
  Não foi introduzida uma nova semântica para `open > close`: períodos que atravessam
  meia-noite continuam sujeitos à modelagem existente de funcionamento por dia.

## Contrato e Android

`GET /availability/slots` preserva `startTime`, `endTime`, `displayLabel` e acrescenta:

```json
{
  "scheduledStartAt": "2035-01-08T04:15:00.000Z",
  "scheduledEndAt": "2035-01-08T04:55:00.000Z",
  "timezone": "America/Manaus"
}
```

Os novos clientes enviam o instante recebido. O frontend falha explicitamente se
receber slots antigos sem UTC, sem inventar um offset. Na futura publicação, backend
deve preceder frontend e a próxima AAB.

Android já instalado continua podendo enviar ISO com `-03:00`, mas isso **não corrige
a intenção local desse aplicativo** em empresas com outros offsets. Não é possível
reinterpretar todo `-03:00` no backend sem alterar o significado de instantes legítimos.
É necessária **nova AAB para incorporar estas correções de interface**, inclusive se
uma AAB foi gerada antes desta tarefa. Nenhum arquivo Android foi modificado/sincronizado.

## Evidências e limites

- 174 testes comuns do backend aprovados, incluindo 30 novos testes temporais.
- 20 testes concorrentes aprovados em PostgreSQL 16 descartável, removido ao final.
  Eles são explicitamente skipped na suíte comum e executados por `npm run test:concurrency`.
- Cenários temporais cobrem hoje, fronteira exata de antecedência, zero, passado,
  funcionamento, data fechada, bloqueios, recorrência inclusiva, virada UTC/local,
  madrugada, UTC+14, Kathmandu, Manaus, São Paulo, Nova York e DST de 23/25 horas.
- As duas suítes temporais também foram executadas com processo em
  `America/Los_Angeles`, além de UTC, sem alteração dos resultados.
- Frontend: 28 testes aprovados, incluindo fluxo real de confirmação da tela que
  envia UTC da API em empresa com offset diferente de -03. Builds e tipos aprovados.
- Nenhum banco real, envio de notificação, migração, commit, push ou deploy nesta etapa.
- Instantes históricos ficam intactos. Registros antigos gravados com a intenção
  local errada exigem auditoria e autorização próprias; não foram corrigidos por palpite.
- Dashboard e outras telas fora da agenda não foram reescritos. Não se afirma uma
  auditoria completa de todo cálculo temporal do produto além dos caminhos acima.
