# Períodos de lavação fechada

Em Configurações, junto aos horários semanais, o administrador informa início e fim do fechamento. Ambas as datas são inclusivas no fuso IANA da empresa. Pode remover um fechamento para restaurar disponibilidade conforme os demais horários e bloqueios.

Implementação reutiliza `ScheduleBlock` não recorrente `FULL_DAY`, estendido para um intervalo de dias com `blockEndDate` opcional no DTO de criação. Não altera schema nem requer migração. Na interface, alteração de período é feita removendo o fechamento e cadastrando o intervalo correto; não foi adicionado editor genérico de bloqueios.

Criação do bloqueio e consulta dos agendamentos afetados ocorrem sob o mesmo bloqueio transacional por empresa usado pelas reservas. Se uma reserva concorrente for confirmada primeiro, ela aparece no retorno de conflito; se o fechamento for confirmado primeiro, a reserva é recusada. Intervalos usam fim exclusivo na meia-noite seguinte ao último dia, incluindo corretamente transições de horário de verão.

Os avisos ao administrador são exibidos ao salvar e na lista persistente de períodos em Configurações, com cliente, código, data/hora e link para a agenda. São consultas atuais a atendimentos CONFIRMED/IN_PROGRESS que se sobrepõem ao período, sempre restritas à empresa. Nenhum agendamento é cancelado, movido ou notificado externamente de forma automática. Atendimentos em andamento continuam sujeitos às restrições de status existentes.

Disponibilidade oferece `includeStatus=true` opcional: retorna slots e indicação genérica de fechamento, sem dados de clientes ou motivo administrativo. O frontend do cliente mostra “Lavação fechada nesta data” e permite escolher outra data. A API de slots sem esse parâmetro mantém o array original para o Android já distribuído, que continua sem horários disponíveis no intervalo. Criação e reagendamento permanecem protegidos no servidor por bloqueios existentes, inclusive para clientes antigos.

Para disponibilizar a tela e a mensagem específica no Android será necessária uma nova AAB. Publicação futura deve começar pelo backend, pois a interface nova envia o parâmetro opcional e a data final. Nenhum deploy ou AAB foi realizado nesta etapa.

Validação: suíte normal backend com 261 testes aprovados; 31 testes reais em PostgreSQL Docker descartável local aprovados separadamente, incluindo intervalo inclusivo, cancelados, remoção, escrita fora do tenant, concorrência e DST. Build backend aprovado. Frontend cobre cadastro, aviso de reagendamento, datas invertidas, remoção e aviso de fechamento ao cliente.

Sem produção, alterações de dados reais, migração, commit ou push.
