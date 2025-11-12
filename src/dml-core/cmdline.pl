:- module(cmdline, [run_dml/1, run_dml_file/1]).

:- style_check(-singleton).
:- use_module(library(main)).
:- use_module(library(optparse)).
:- use_module(plogchain).

%:- initialization(main, main).

% Global variable to store last generated DML
:- dynamic(last_generated_dml/1).

:- dynamic(tools_description/1).


% Helper predicate to check if a file is a regular file
is_regular_file(Dir, File) :-
    \+ member(File, ['.', '..']),
    string_concat(Dir, "/", DirSlash),
    string_concat(DirSlash, File, FullPath),
    exists_file(FullPath).

process_question(Question) :-
    uuid(UUID),
    split_string(UUID, "-", "", List),
    atomics_to_string(List, "", UUID2),
    format(atom(MemId), 'mem~w', [UUID2]),
    format(atom(SessionIdServer), 'sess~w', [UUID2]),

    create_memory(MemId),
    
    MaxAttempt is 3,
    
    % Use plogchain auto-generation logic
    %writeln("Generating plan..."),
    findall(Config, deploy:mcp(_, Config), MCPConfigs),
    between(0, MaxAttempt, Attempt),
    (
        %format("Attempt ~w: Trying to generate a plan...~n", [Attempt]),
        
        % Generate goal with reasoning output
        (
            format(string(MsgAttempt), '<generation_attempt num="~w">~n', [Attempt]),
            py_call(bridge:'rich_print'(MsgAttempt)),
            py_iter(bridge:'question_to_prolog'(Question, Attempt, MCPConfigs, "./dml_examples"), ConvertReturn),
            (
                (
                    atom(ConvertReturn),
                    %format("~w~n", [ConvertReturn]),
                    py_call(bridge:'rich_print'(ConvertReturn)),
                    fail
                )
            ;
                ( 
                    is_dict(ConvertReturn), Goal = ConvertReturn.code,
                    % Store the generated DML for potential saving
                    retractall(last_generated_dml(_)),
                    assertz(last_generated_dml(Goal))
                )
            ),
            py_call(bridge:'rich_print'('</generation_attempt>\n'))
        ),
        
        % Parse and validate the goal
        catch(
            parse_goal(SessionIdServer, SessionIdServer:context, MemId, Goal, ErrorMsg),
            ParserError,
            true
        ),
        
        % Check if parsing succeeded
        ( (var(ErrorMsg), var(ParserError)) -> 
            GoalFinal = Goal,
            format("Goal parsing succeeded!~n")
        ;
            (
                \+var(ErrorMsg) -> 
                format("Parse Error: ~w~n", [ErrorMsg])
            ;
                true
            ),
            (
                \+var(ParserError) -> 
                format("Parser Exception: ~w~n", [ParserError])
            ;
                true
            ),
            (Attempt < MaxAttempt -> 
                fail
            ;
                format("Failed to generate valid plan after ~w attempts~n", [MaxAttempt]),
                fail
            )
        )
    ),

    py_call(bridge:'rich_print'("\n**Generated DML:**\n")),
    format("~w~n", [GoalFinal]),
    
    % Show generated DML and ask for confirmation
    %format("~nGenerated DML:~n~w~n~n", [GoalFinal]),
    prompt(Old, '[Enter to execute]'),
    py_call(bridge:'rich_print'('<input>Press enter to start execution.</input>')),
    prompt(_, Old),
    read_string(user_input, "\n", "\t ", End, _Output),

    % Execute directly without engines
    Params = py{workspace_path: "./workspace"},
    %create dir if not exists
    (   \+exists_directory('./workspace') -> 
        make_directory('./workspace')
    ;   true
    ),
    format("Executing...~n"),
    assertz(SessionIdServer:context('')),
    findall(C, (deploy:mcp(S, C), assertz(SessionIdServer:mcp(S,C))), _),
    catch(
        plogchain(SessionIdServer, SessionIdServer:context, MemId, GoalFinal, Params, Result),
        ExecutionError,
        (
            format("EXECUTION ERROR: ~w~n", [ExecutionError]),
            Result = error(ExecutionError)
        )
    ),
    
    % Display result
    format("~nResult: ~w~n", [Result]),
    writeln("Tip: Use '/savedml <filename>' to save this DML for reuse").


run_dml(DmlCode) :-

    assertz(deploy:mcp('local', json{type: "local"})),

    uuid(UUID),
    split_string(UUID, "-", "", List),
    atomics_to_string(List, "", UUID2),
    format(atom(MemId), 'mem~w', [UUID2]),
    format(atom(SessionIdServer), 'sess~w', [UUID2]),
    create_memory(MemId),

  

    catch(
      parse_goal(SessionIdServer, SessionIdServer:context, MemId, DmlCode, ErrorMsg),
      ParserError,
      true
    ),
 
    (
      \+var(ErrorMsg) -> 
      format(string(ErrorStr), "Error: ~w", [ErrorMsg]),
      print_message(information, ErrorStr),
      GoalFinal = ""
    ;
      ErrorMsg = "", 
      true
    ),
    (
      \+var(ParserError) -> 
      format(string(ParserErrorMsg), "ParserError: ~w", [ParserError]),
      GoalFinal = ""
    ;
      ParserErrorStr = "",
      true
    ),
    (GoalFinal == "" ->
      format(string(ErrorMsg), "Failed: (~w) - (~w)\n\n", [ErrorMsg, ParserErrorMsg]),
      fail
    ;          
    GoalFinal = DmlCode
    ),

    Params = py{workspace_path: "./workspace"},
    %create dir if not exists
    (   \+exists_directory('./workspace') -> 
        make_directory('./workspace')
    ;   true
    ),
    format("Executing...~n"),
    assertz(SessionIdServer:context('')),
    findall(C, (deploy:mcp(S, C), assertz(SessionIdServer:mcp(S,C))), _),
    catch(
      plogchain(SessionIdServer, SessionIdServer:context, MemId, GoalFinal, Params, Result),
      ExecutionError,
      (
        print_message(information, ExecutionError),
        format(string(ErrorMsg), '\n\n**EXECUTION ERROR:** ~w\n\n**TERMINATED**', [ExecutionError])
      )
    ),
     
    format('~n[DONE]~n~n'),

    flush_output.

% Run DML code from a file in dml_examples directory
run_dml_file(Filename) :-
    string_concat("dml_examples/", Filename, FullPath),
    (   exists_file(FullPath)
    ->  format('Reading and executing DML file: ~w~n', [FullPath]),
        read_file_to_string(FullPath, DmlCode, []),
        run_dml(DmlCode)
    ;   format("File ~w does not exist in dml_examples/~n", [Filename])
    ).


question_to_dml(Question, GoalFinal) :-
    uuid(UUID),
    split_string(UUID, "-", "", List),
    atomics_to_string(List, "", UUID2),
    format(atom(MemId), 'mem~w', [UUID2]),
    format(atom(SessionIdServer), 'sess~w', [UUID2]),

    create_memory(MemId),
    
    MaxAttempt is 3,
    
    % Use plogchain auto-generation logic
    %writeln("Generating plan..."),
    findall(Config, deploy:mcp(_, Config), MCPConfigs),
    between(0, MaxAttempt, Attempt),
    (
        %format("Attempt ~w: Trying to generate a plan...~n", [Attempt]),
        
        % Generate goal with reasoning output
        (
            format(string(MsgAttempt), '<generation_attempt num="~w">~n', [Attempt]),
            py_call(bridge:'rich_print'(MsgAttempt)),
            py_iter(bridge:'question_to_prolog'(Question, Attempt, MCPConfigs, "./dml_examples"), ConvertReturn),
            (
                (
                    atom(ConvertReturn),
                    %format("~w~n", [ConvertReturn]),
                    py_call(bridge:'rich_print'(ConvertReturn)),
                    fail
                )
            ;
                ( 
                    is_dict(ConvertReturn), Goal = ConvertReturn.code,
                    % Store the generated DML for potential saving
                    retractall(last_generated_dml(_)),
                    assertz(last_generated_dml(Goal))
                )
            ),
            py_call(bridge:'rich_print'('</generation_attempt>\n'))
        ),
        
        % Parse and validate the goal
        catch(
            parse_goal(SessionIdServer, SessionIdServer:context, MemId, Goal, ErrorMsg),
            ParserError,
            true
        ),
        
        % Check if parsing succeeded
        ( (var(ErrorMsg), var(ParserError)) -> 
            GoalFinal = Goal,
            format("Goal parsing succeeded!~n")
        ;
            (
                \+var(ErrorMsg) -> 
                format("Parse Error: ~w~n", [ErrorMsg])
            ;
                true
            ),
            (
                \+var(ParserError) -> 
                format("Parser Exception: ~w~n", [ParserError])
            ;
                true
            ),
            (Attempt < MaxAttempt -> 
                fail
            ;
                format("Failed to generate valid plan after ~w attempts~n", [MaxAttempt]),
                fail
            )
        )
    ),

    py_call(bridge:'rich_print'("\n**Generated DML:**\n")),
    format("~w~n", [GoalFinal]),
    writeln("Tip: Use '/savedml <filename>' to save this DML for reuse").



% Helper predicate to collect all output from an engine
collect_engine_output(EngineId, Acc) :-
    (   catch(engine_next(EngineId, Output), Error, fail)
    ->  (   Output = wait(WaitMsg)
        ->  % Handle wait for input
            format("~w", [WaitMsg]),
            read_string(user_input, "\n", "\t ", _, UserInput),
            engine_post(EngineId, UserInput),
            collect_engine_output(EngineId, Acc)
        ;   % Regular output
            format("~w", [Output]),
            collect_engine_output(EngineId, [Output|Acc])
        )
    ;   % Engine finished or failed
        true
    ).


% Generate a string listing all DML files with descriptions for prompts
get_dml_files_description(Description) :-
    plogchain:py_call(bridge:'get_dml_files_description'(), Description).

% Helper predicate to check if a file is a DML file
is_dml_file(Dir, File) :-
    \+ member(File, ['.', '..']),
    string_concat(Dir, "/", DirSlash),
    string_concat(DirSlash, File, FullPath),
    exists_file(FullPath),
    \+ atom_concat(_, '.txt', File).  % Exclude .txt files

% Format a single DML file with its description
format_dml_file_description(Filename, FormattedDescription) :-
    % Get the base name without extension
    file_name_extension(BaseName, _, Filename),
    % Create the description file path
    format(string(DescFile), 'dml_examples/~w.txt', [BaseName]),
    % Read description if it exists
    (   exists_file(DescFile)
    ->  read_file_to_string(DescFile, RawDescription, []),
        % Clean up the description (remove extra whitespace/newlines)
        split_string(RawDescription, '\n', ' \t', Lines),
        include(\=(''), Lines, CleanLines),
        atomic_list_concat(CleanLines, ' ', CleanDescription)
    ;   CleanDescription = "No description available"
    ),
    % Format as "filename: description"
    format(string(FormattedDescription), '- ~w: ~w', [Filename, CleanDescription]).

% Get tool descriptions for use in prompts
get_tools_description(ToolsDescription) :-
    findall(Desc, tools_description(Desc), R),
    R = [ToolsDescription|_].

    %ToolsDescription = "asd".
    %catch(ToolsDescription := global.getToolsDescription(), Error, (writeln(Error), ToolsDescription = "Error retrieving tool descriptions")).
    %plogchain:py_call(bridge:'get_tools_description'(), ToolsDescription="").



% New cooperative engine management predicates
:- dynamic(cooperative_engine/4).  % cooperative_engine(EngineId, Engine, MemoryId, Status)
:- dynamic(engine_output_buffer/2). % engine_output_buffer(EngineId, OutputList)
:- dynamic(engine_input_queue/2).   % engine_input_queue(EngineId, InputList)

% Initialize a cooperative execution engine
init_cooperative_engine(DmlCode, EngineId, MemoryId, Memory, Params) :-
    init_cooperative_engine(DmlCode, EngineId, MemoryId, Memory, Params, Success, Error).

init_cooperative_engine(DmlCode, EngineId, MemoryId, Memory, Params, Success, Error) :-
    writeln("Initializing cooperative engine..."),
    catch(
        (
            % Clean up any existing engine with same ID
            cleanup_cooperative_engine(EngineId, MemoryId),
            % Create memory and session context
            create_memory(MemoryId),
            format(atom(SessionId), 'sess_~w', [EngineId]),
            % Parse and validate the DML code
            catch(
                parse_goal(SessionId, SessionId:context, MemoryId, DmlCode, ErrorMsg),
                ParseError,
                ErrorMsg = ParseError
            ),
            (   var(ErrorMsg)
            ->  % Parsing succeeded, create engine
                assertz(SessionId:context('')),
                %findall(C, (deploy:mcp(S, C), assertz(SessionId:mcp(S,C))), _),
                

                writeln("Parsing succeeded. Creating engine..."),
                writeln(Params),
         
                % Create the execution engine
                engine_create(
                    Result,
                    catch(
                        plogchain(SessionId, SessionId:context, MemoryId, DmlCode, Params, Result),
                        ExecError,
                        (
                            writeln("Execution failed:"), writeln(ExecError),
                            Result = error(ExecError)
                        )
                    ),
                    Engine
                ),
                writeln("Cooperative engine initialized."),
                
                % Store engine information
                assertz(cooperative_engine(EngineId, Engine, MemoryId, active)),
                assertz(engine_output_buffer(EngineId, [])),
                assertz(engine_input_queue(EngineId, [])),
                
                Success = true,
                Error = none
            ;   % Parsing failed
                Success = false,
                Error = ErrorMsg
            )
        ),
        InitError,
        (
            Success = false,
            Error = InitError
        )
    ).

% Step through cooperative engine execution
step_cooperative_engine(EngineId) :-
    step_cooperative_engine(EngineId, Status, Output).

step_cooperative_engine(EngineId, Status, Output) :-
    catch(
        (
            cooperative_engine(EngineId, Engine, _, active)
        ->  % Engine exists and is active
            (   
                catch(engine_next(Engine, EngineOutput), EngineError, (writeln("Engine step failed:"), writeln(EngineError), fail))
            ->  % Engine produced output
                process_engine_output(EngineId, EngineOutput, Status, Output)
            ;   % Engine finished or failed
                retract(cooperative_engine(EngineId, Engine, MemoryId, active)),
                assertz(cooperative_engine(EngineId, Engine, MemoryId, finished)),
                Status = finished,
                Output = ""
            )
        ;   cooperative_engine(EngineId, _, _, finished)
        ->  % Engine already finished
            Status = no_more,
            Output = ""
        ;   % Engine doesnt exist
            Status = error,
            Output = "Engine not found or not initialized"
        ),
        StepError,
        (
            Status = error,
            writeln("Engine finished. 4")
        )
    ).

% Process different types of engine output
process_engine_output(EngineId, EngineOutput, Status, Output) :-
    (   EngineOutput = wait(Message)
    ->  % Engine is waiting for input
        Status = wait_input,
        Output = Message
    ;   is_dict(EngineOutput)
    ->  % Structured output (likely from plogchain)
        Status = output,
        format(string(Output), "~w", [EngineOutput])
    ;   atom(EngineOutput)
    ->  % Text output
        Status = output,
        Output = EngineOutput
    ;   EngineOutput = request_call(What)
    ->  % Waiting for a function call
        Status = request_call,
        Output = What
    ;   % Other output types
        Status = output,
        format(string(Output), "~w", [EngineOutput])
    ).

% Send input to a waiting engine
send_input_to_engine(EngineId, Input) :-
    send_input_to_engine(EngineId, Input, Success).

send_input_to_engine(EngineId, Input, Success) :-
    catch(
        (
            cooperative_engine(EngineId, Engine, _, active)
        ->  % Engine exists and is active
            (   catch(engine_post(Engine, Input), PostError, fail)
            ->  Success = true
            ;   Success = false
            )
        ;   % Engine not found or not active
            Success = false
        ),
        InputError,
        Success = false
    ).

% Clean up cooperative engine resources
cleanup_cooperative_engine(EngineId, MemoryId) :-
    catch(
        (
            % Clean up engine if it exists
            (   cooperative_engine(EngineId, Engine, _, _)
            ->  (   is_engine(Engine)
                ->  engine_destroy(Engine)
                ;   true
                ),
                retractall(cooperative_engine(EngineId, _, _, _))
            ;   true
            ),
            
            % Clean up buffers and queues
            retractall(engine_output_buffer(EngineId, _)),
            retractall(engine_input_queue(EngineId, _)),
            
            % Clean up memory if it exists
            (   var(MemoryId)
            ->  true
            ;   catch(delete_memory(MemoryId), _, true)
            ),
            
            % Clean up session context
            format(atom(SessionId), 'sess_~w', [EngineId]),
            catch(retractall(SessionId:context(_)), _, true),
            catch(retractall(SessionId:mcp(_, _)), _, true)
        ),
        CleanupError,
        true  % Ignore cleanup errors
    ).


% Collect output from cooperative engine step by step
collect_cooperative_output(EngineId, _Acc) :-
    step_cooperative_engine(EngineId, Status, Output),
    (   Status = output
    ->  format("~w", [Output]),
        collect_cooperative_output(EngineId, _Acc)
    ;   Status = wait_input
    ->  format("~w", [Output]),
        read_string(user_input, "\n", "\t ", _, UserInput),
        send_input_to_engine(EngineId, UserInput, _),
        collect_cooperative_output(EngineId, _Acc)
    ;   Status = finished
    ->  (   Output \= ""
        ->  format("~w", [Output])
        ;   true
        )
    ;   Status = no_more
    ->  true
    ;   Status = error
    ->  format("Error: ~w~n", [Output])
    ;   format("Unknown status: ~w, output: ~w~n", [Status, Output])
    ).


