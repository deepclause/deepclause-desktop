:- module(plogchain, [try_parse/1,
parse_goal/5,plogchain/6,  
context/1, bindings/2, ask/5, create_memory/1, create_memory/2, push_memory/2, ask/5, mi/5,
yield/1,
wait_for_input/2,
llm_evaluate_goal/6,
get_assignment/4

]).

:- use_module(library(apply)).
:- use_module(library(assoc)).
:- use_module(library(http/json_convert)).
:- use_module(library(term_to_json)).
:- use_module(library(clpfd)).
:- use_module(library(clpr)).
:- use_module(library(lists)).
:- use_module(library(quasi_quotations)).
:- use_module(library(strings)).
:- use_module(library(random)).


:- use_module(dml_strings).

:- dynamic context/1.
:- dynamic without_context/1.
:- dynamic failure/1.
:- dynamic is_user_rule/2.
:- dynamic is_llm_rule/2.
:- dynamic state_params/3.

:- json_object message(role:any, content:any).

maplist_([], [], [], [], [], _).
maplist_([Elem1|Tail1],
               [Elem2|Tail2],
               [Elem3|Tail3],
               [Elem4|Tail4],
               [Elem5|Tail5],
               Goal) :-
    call(Goal, Elem1, Elem2, Elem3, Elem4, Elem5),
    maplist_(Tail1, Tail2, Tail3, Tail4, Tail5, Goal).







:- meta_predicate maplist(5,?,?,?,?,?).

maplist(Goal, List1, List2, List3, List4, List5) :-
  maplist_(List1, List2, List3, List4, List5, Goal).


end_thinking :-
  yield("<end_thinking>\n\n").




% Why the cuts?
yield(tool_call=What) :-
  format(string(WhatStr), '<log>Calling tool: ~w</log>', [What]),
  string_length(WhatStr, L),
  ( L > 0 
  ->
    (   engine_self(E), is_engine(E)
    ->
        catch(engine_yield(WhatStr),Error, writeln((Error, WhatStr)))
        %writeln(WhatStr) 
     ;
        %write(WhatStr) 
        py_call(bridge:'rich_print'(WhatStr))
     )
   ),!. 

yield(exec_result=What) :-
  format(string(WhatStr), '\nExecution result: ~w~n~n', [What]),
  string_length(WhatStr, L),
  ( L > 0 
  ->
    (   engine_self(E), is_engine(E)
    ->
        catch(engine_yield(WhatStr),Error, writeln((Error, WhatStr)))
        %writeln(WhatStr) 
     ;
        py_call(bridge:'rich_print'(WhatStr))
     )
   ),!. 

yield(exec=What) :-
  format(string(WhatStr1), '~w', [What]),
  string_length(WhatStr1, N),
  M is min(N, 100),
  sub_string(WhatStr1, 0, M, _, WhatStr2),
  format(string(WhatStr), '<log>Executing goal: ~w...</log>~n', [WhatStr2]),
  string_length(WhatStr, L),
  ( L > 0 
  ->
    (   engine_self(E), is_engine(E)
    ->
        catch(engine_yield(WhatStr),Error, writeln((Error, WhatStr)))
        %writeln(WhatStr) 

      ;
        py_call(bridge:'rich_print'(WhatStr))
     )
   ),!. 

yield(debug=What) :-
  format(string(WhatStr), '~w', [What]),
  writeln(debug=WhatStr),!.

yield(log>What) :-
  format(string(WhatStr), '<log>~w</log>~n', [What]),
  string_length(WhatStr, L),
  ( L > 0 
  ->
    (   engine_self(E), is_engine(E)
    ->
        catch(engine_yield(WhatStr),Error, writeln((Error, WhatStr)))
        %writeln(WhatStr) 
      ;
        %write(WhatStr)
        py_call(bridge:'rich_print'(WhatStr))
     )
   ),!.

yield(What) :-
  format(string(WhatStr), '~w', [What]),
  string_length(WhatStr, L),
  ( L > 0 
  ->
    (   engine_self(E), is_engine(E)
    ->
        catch(engine_yield(WhatStr),Error, writeln((Error, WhatStr)))
        %writeln(WhatStr) 
      ;
       % write(WhatStr)
       py_call(bridge:'rich_print'(WhatStr))
     )
   ). 


answer(What) :-
  yield("\n<end_thinking>\n\n"),
  yield(What).

wait_for_input(What, Output) :-
  format(string(WhatStr), '~w', [What]),
  string_length(WhatStr, L),
  ( L > 0 
  ->
    (   engine_self(E)
    ->
        engine_yield(wait(WhatStr)),
        engine_fetch(Output)
      ;
        %writeln(WhatStr),
        format(string(WhatStr0), '<input>~w</input>', [WhatStr]),
        py_call(bridge:'rich_print'(WhatStr0)),
        prompt(Old, 'User input> '),
        read_string(user_input, "\n", "\t ", End, Output),
        prompt(_, Old)
     )
   ).

py_call(What, Output) :-
    (   engine_self(E)
    ->
        engine_yield(request_call(What)),
        engine_fetch(Output)
      ;
        writeln("WARNING not in an engine!"),
        fail
   ).

py_iter(What, Output) :-
    (   engine_self(E)
    ->
        engine_yield(request_call(What)),
        engine_fetch(Output)
      ;
        writeln("WARNING not in an engine!"),
        fail
   ).


%:- table llm_evaluate_goal/6.
llm_evaluate_goal(Session, Context, Memory,  Goal, Response, RuleExplanationString) :-
    %(call(Context, C)-> true; C=''), %C='Not available. User either own knowledge or tools.'),
    % fetch_memory(Memory, Messages),
    % atomic_list_concat(Mem, MemStr),
    % atom_concat(C, MemStr, Text),
    %
   % trace,
    catch(
    (findall(C, call(Context,C), Contexts),
    atomics_to_string(Contexts, "\n\n", Text),
    %with_output_to(atom(GoalStr), write_term(Goal, [quoted(true)])),
    GoalStr = "",
    orig_goal_str(Session, Goal, OrigGoalStr),
    %yield(step=OrigGoalStr),

    writeln("Evaluating goal via LLM:"),writeln(Goal),

    Goal =.. GoalList,
    
    maplist(term_to_atom, GoalList, GoalList1),

    writeln(GoalList1),
    writeln("----"),
    
    atom_to_term(OrigGoalStr, OrigGoal, Bindings),
   
    OrigGoal =.. OrigGoalList,
    
    maplist(term_to_atom, OrigGoalList, OrigGoalList1),
    maplist(term_to_atom, Bindings, Bindings1),

    % Loop over streaming output until we get a dict with all the data
    py_iter(bridge:evaluate_goal(GoalStr, OrigGoalStr, GoalList1, OrigGoalList1, Bindings1, RuleExplanationString, Text), X),
      ((atom(X),yield(X),fail);(is_dict(X), Response=X))),

    Error,

    (writeln("ERROR!"), writeln(Error), fail)).
    
    %yield(step_truth=Response.result).
    %yield(step_data=Response.variable_assignments). %TODO add a message with summary to Memory


question_to_goal(Question, Goal, Bindings) :-
    py_call(bridge:'question_to_prolog'(Question), Predicate),
    format('Goal: ~w\n', [Predicate]),
    yield(goal=Predicate),
    atom_to_term(Predicate, Goal, Bindings).


exec_tool(Prompt, ToolResponse, Memory, Session) :-
  ( \+((string(Prompt);atom(Prompt))) 
  -> 
    with_output_to(atom(StrPrompt), write_term(Prompt,[quoted(true)]))
  ; 
    StrPrompt=Prompt),  
  fetch_memory(Memory, Messages),
  findall(Config, Session:mcp(_, Config), MCPConfigs),
  (py_iter(bridge:'tool_agent'(StrPrompt, 0, Messages, Session, MCPConfigs), Output),
    (
      is_dict(Output) 
    -> (!, 
      ToolResponse = Output.tool_output,
      Output.success = true
      %format(string(Msg), 'Observation: ~w', [ToolResponse]),
      %push_memory(Memory, {role: 'assistant', content: Msg})
      ) %probably dont need the cut
    ; 
      (yield(Output), fail)
    )
  ).

exec_chat(Prompt,Response, Memory) :-
  ( \+((string(Prompt);atom(Prompt))) 
  -> 
    with_output_to(atom(StrPrompt), write_term(Prompt,[quoted(true)]))
  ; 
    StrPrompt=Prompt),  
  fetch_memory(Memory, Messages),
  %term_to_json:term_to_json(Messages, MessagesJson),
  %open_string()
  (py_iter(bridge:'instruction'(StrPrompt, 0, messages{list:Messages}), Output),
    (
      is_dict(Output) 
    -> (!, 
      Response = Output.all_output,
      format(string(Msg), '~w', [Response]),
      push_memory(Memory, message{role: 'user', content: StrPrompt}),
      push_memory(Memory, message{role: 'assistant', content: Msg})
      ) %probably dont need the cut
    ; 
      (yield(Output), fail)
    )
  ).


exec_chat(Prompt, Response) :-
  ( \+((string(Prompt);atom(Prompt))) 
  -> 
    with_output_to(atom(StrPrompt), write_term(Prompt,[quoted(true)]))
  ; 
    StrPrompt=Prompt),  
  (py_iter(bridge:'instruction'(StrPrompt, 0, messages{list:[]}), Output),
    (
      is_dict(Output) 
    -> (!, 
      Response = Output.all_output,
      format(string(Msg), '~w', [Response])
      ) %probably dont need the cut
    ; 
      (
        yield(Output),
       fail)
    )
  ).


exec_generation(Prompt, Response) :-
  ( \+((string(Prompt);atom(Prompt))) 
  -> 
    with_output_to(atom(StrPrompt), write_term(Prompt,[quoted(true)]))
  ; 
    StrPrompt=Prompt),  
  (py_iter(bridge:'generation'(StrPrompt, 0, messages{list:[]}), Output),
    (
      is_dict(Output) 
    -> (!, 
      Response = Output.all_output,
      format(string(Msg), '~w', [Response])
      ) %probably dont need the cut
    ; 
      (
       % yield(Output),
       fail)
    )
  ).


exec_push(MemItem, Memory) :-
  push_memory(Memory, MemItem).
 
exec_pop(Memory) :-
  engine_post(Memory, pop_item, _).

read_term__(Val,X) :-
  catch(read_term_from_atom(Val, X,[]),Error , (
      yield(log>"Warning: structured extraction for Goal failed. Assuming string."),
      %print_message(information, "ERROR"),
      %print_message(information, Error),
      fail
      )).
  
get_assignment(Response, Key, Out, SubIndex) :- 
  VA = Response.variable_assignments,
  nth0(SubIndex, VA, VAV),
  nth0(Key, VAV, Val),
  Out = Val. %TODO expand if structured
  %( 
  %  catch(
      %read_term_from_atom(Val, XX,[])
   %   (write("Expanding plan from value: "), writeln(Val),
    %  expand_plan(Val, XX),
     % writeln("parsed to: "), writeln(XX))
      %
    %, Error,
     %(
      %print_message(information, "ERROR"),
      %print_message(information, Error),
      %fail
      %)
     % 
    %)
    %  
    %   ->
    %XX=(SomeValue), Out=SomeValue
  %;
  %  yield(log>"WARNING! Could not parse return value, assuming string!"),
  %  format(string(Out), '~w', [Val])
  %).
  %#   \+ Val = [_|_]
  %# -> (
  %#       (\+integer(Val), \+float(Val))
  %#     -> 
  %#       (catch(atom_number(Val,X), Error, fail) -> true;X=Val)
  %#     ;
  %#       X = Val
  %#    )
  %# ;
  %   X = Val
  %).



assignment_term(RSS,  Index, Var,  Term) :- 
    [Response,S] = RSS,
    Term = (\+(var(Var)) -> true;(get_assignment(Response, Index, Var, S))).


bindings(A, Term) :- format(atom(TermStr), '~w', [A]), Term=(TermStr=A).

orig_goal_str(Session, Goal, OrigGoalStr) :- 
    Goal =.. TermList, TermList = [H|T],
    
    findall(_, Session:def(A,B), RR), 
    
    findall(OrigGoalStr, Session:def(H, OrigGoalStr), R), 
   
    length(R,L), 
    (L > 0  
      -> nth0(0, R, OrigGoalStr)
    ;
      OrigGoalStr=" ").

user:expand_query(Query, Expanded, Bindings, ExpandedBindings) :-
  retractall(variable_assignments(X)),
  forall(member(B, Bindings),
    (B=(X=Y),format(atom(XX), '~w', [X]),
     format(atom(YY), '~w', [Y]),
     assertz(variable_assignments(YY=XX)))),
  Query = Expanded, Bindings = ExpandedBindings.

% TODO The Bindings need to be module dependent
save_bindings(Bindings) :-
  retractall(variable_assignments(X)),
  forall(member(B, Bindings),
    (B=(X=Y),format(atom(XX), '~w', [X]),
     format(atom(YY), '~w', [Y]),
     assertz(variable_assignments(YY=XX)))).


zip([], [], []).
zip([X|Xs], [Y|Ys], [[X,Y]|Zs]) :- zip(Xs,Ys,Zs).

varn(N,'$VAR'(N)).

list_to_conjunction([], true).
list_to_conjunction([Goal| Goals], Conjunction) :-
	list_to_conjunction(Goals, Goal, Conjunction).
list_to_conjunction([], Conjunction, Conjunction).
list_to_conjunction([Next| Goals], Goal, (Goal,Conjunction)) :-
	list_to_conjunction(Goals, Next, Conjunction).

var_in_bindings(Vars, B) :- 
  B = (X=Y), 
  format(atom(XX), '~w', [X]),
  format(atom(YY), '~w', [Y]),
  member(V, Vars),
  format(atom(VV), '~w', [V]),
  (XX = VV; YY = VV).


%TODO This predicate is a big mess and needs to be rewritten
  %analyze(Module, Context, Memory,  [], GoalRewrite) :- !, GoalRewrite=Goal,true.
analyze(Module, Context, Memory, Goal, GoalRewrite) :- string(Goal),!,GoalRewrite=Goal,true.
analyze(Module, Context, Memory, Goal, GoalRewrite) :- atom(Goal), catch(atom_to_term(Goal, Term, _), Error, true), \+(var(Error)), !, GoalRewrite = Goal .
analyze(Module, Context, Memory, Goal, GoalRewrite) :- var(Goal), !, GoalRewrite = Goal, true.

analyze(Module, Context, Memory, Goal, GoalRewrite) :- is_dict(Goal), !, GoalRewrite = Goal, true.


analyze(Module, Context, Memory, Goal, GoalRewrite) :-   Goal = tool(A,B),!, GoalRewrite = tool(A,B), true.
analyze(Module, Context, Memory, Goal, GoalRewrite) :-   Goal = chat(A), !, GoalRewrite = chat(A), true.
analyze(Module, Context, Memory, Goal, GoalRewrite) :-   Goal = push(A), !, GoalRewrite = push(A), true.

analyze(Module, Context, Memory, Goal, GoalRewrite) :- float(Goal), !, GoalRewrite = Goal, true.

analyze(Module, Context, Memory, Goal, GoalRewrite) :- Goal =.. TermList,
  TermList = [H|T], H == ':', !, GoalRewrite = Goal, true.

analyze(Module, Context, Memory, Goal, GoalRewrite) :-   Goal = log(A),!, GoalRewrite = log(A), true.

analyze(Module, Context, Memory, Goal, GoalRewrite) :-

  
  Goal =.. TermList,
  TermList = [H|T],
  length(T, NumArgs),
  findall(X, between(1, NumArgs, X), ArgdIds),
  NumArgs0 is NumArgs - 1,
  findall(X, between(0, NumArgs0, X), ArgdIds0),
  maplist(varn, ArgdIds, ArgList),
  maplist(bindings, ArgList, NewBindings),
  NewGoal =.. [H|ArgList],
  format(atom(NewGoalStr), '~w', [NewGoal]),
  (atom_to_term(NewGoalStr, NewGoalTerm, NewBindings)
  -> true; atom_to_term(NewGoalStr, NewGoalTerm, _)
  ),

  format(atom(GoalStr), '~w', [Goal]),


  writeln("Analyzing goal:"),writeln(Goal),writeln(H),writeln("asdad---"),

  (\+(
      predicate_property(NewGoalTerm, built_in);
      var(H);
      string(H);
      integer(H);
      H = 'member';
      H = 'include';
      H = 'exclude';
      H = 'analyze';
      H = 'ask';
      H = 'new_context';
      H = 'foreach';
      H='\\+';
      H='+';
      H='-';
      H='/';
      H='*';
      H=':-';
      H='-->';
      H='wait_for_input';
      H='observation';
      H='plogchain';
      H='yield';
      H='end_thinking';
      H='answer';
      H='append';
      H='length';
      H='is';
      H='tool';
      H='chat';
      H='system';
      H='user';
      H='get_memory';
      H='set_memory';
      H='clear_memory';
      H='maplist';
      H='member';
      H='pairs_keys_values';
      H='log';
      H='param';
      H='run_dml';
      H='run_dml_file';
      H='foldl';
      H='generate';
      NewGoalStr='[]';
      NewGoalStr='[|]';
      catch(current_predicate(Module:H/NumArgs), Error, fail)
  ) -> (
    
    

    format(string(EmptyStr), "\"na\"",[]),

    (NumArgs > 0 
      -> 
        (
          findall(X, variable_assignments(X), OriginalBindings),
          with_output_to(atom(GoalStr), write_term(Goal, [quoted(true)])),
          term_variables(Goal, Vars),
          include(var_in_bindings(Vars), OriginalBindings, TermBindings),
          atom_to_term(GoalStr, GoalTerm, TermBindings),
          with_output_to(atom(GoalTermStr), write_term(GoalTerm, [quoted(true)])),
          %retractall(def(H, _)),
          %% lts not do this 
          %assertz(Module:def(H, GoalTermStr)), %TODo make this dependent on the session id, as well as the arity 
          true
        )
      ;
          true
      ),
    
      (NumArgs == 0, \+is_user_rule(Module, H) ) -> (assertz(
      (Module:NewGoalTerm :- 
              (catch(
                (llm_evaluate_goal(Session, Context, Memory, NewGoalStr, Response, "na"), 
                 get_dict('result', Response, true)),
                
                 Error, (yield('"\\n\\n**ERROR:\\n\\n"'), yield(Error), fail)
              ))
          )), 
          
          %lets not do this
          %assertz(Module:def(H, NewGoalTerm)),
          true
          )
      ;

      length(AssignmentsList, NumArgs),
      length(R, NumArgs),
      maplist(=(Response), R),
      length(SS, NumArgs),
      maplist(=(S), SS),
      zip(R,SS, RSS),
      maplist(assignment_term, RSS, ArgdIds0,ArgList,  AssignmentsList),
      list_to_conjunction(AssignmentsList, Assignments),

      format(atom(RStr), '~w', 
        [NewGoalTerm :- %Substitute this with a rule that just returns the rule name and original context, rst in MI?
          (
              catch((llm_evaluate_goal(Session, Context, Memory, NewGoalStr, Response, "na"), 
              get_dict('result', Response, true),
              get_dict('variable_assignments', Response, VA),
              length(VA, NumAssignments), NumAssignments > 0,
              NumAssignments0 is NumAssignments-1,
              between(0, NumAssignments0,S ), 
              (Assignments)), Error, (yield('"\\n\\n**ERROR:\\n\\n"'), yield(Error), fail)) 
          )
        ]
      ),
      atom_to_term(RStr, Term,_),
      retractall(NewGoalTerm),
      % Lets not do this
      % (\+is_user_rule(Module, H) -> assertz((Module:Term));true),
      Rewrite = 0
    )
    ;
    Rewrite = 0, %write('Built in predicate '), write(H), write(' Ignoring...'),nl,
    true),

    length(LContext, NumArgs),
    length(LMemory, NumArgs),
    length(LModule, NumArgs),
    maplist(=(Context), LContext),
    maplist(=(Memory), LMemory),
    maplist(=(Module), LModule),


    (
      H \= ':-' 
    -> 
      %forall(member(Arg,T), analyze(Context, Memory, Arg)),
      maplist(analyze, LModule, LContext, LMemory, T, LNewArgs),
      ( 
         (Rewrite == 1;is_user_rule(Module,H);is_llm_rule(Module,H))
      -> 
         OrigCall =.. [H|LNewArgs],
         GoalRewrite =.. [:, Module, OrigCall]
      ;
         GoalRewrite =.. [H|LNewArgs]
      )
    ;
      T = [HH|TT],

      % HH =.. [RuleName|RuleArgs],
      % writeln((RuleName, RuleArgs)),
      % assertz(is_user_rule(Module, RuleName)),
      Head = HH, Tail = TT,
      length(LContext0, NumArgs0),
      length(LMemory0, NumArgs0),
      length(LModule0, NumArgs0),
      maplist(=(Context), LContext0),
      maplist(=(Memory), LMemory0),
      maplist(=(Module), LModule0),
      %forall(member(Arg,TT), analyze(Context, Memory, Arg)),
      maplist(analyze, LModule0, LContext0, LMemory0, TT, LNewArgs0),
      
      ( 
         GoalRewrite0 =.. [:, Module, Head],
         % writeln(LNewArgs0),
         GoalRewrite =.. [:-, GoalRewrite0 | LNewArgs0]
      ),

      ( (GoalRewrite \= (A:-format(_,_,_),@(_))) ->
        assertz(GoalRewrite)
      ;
        true
      )
    ).



add_llm_rule(Module, Context, Memory, Goal, RuleExplanationString) :-
  Goal =.. TermList,
  TermList = [H|T],
  length(T, NumArgs),
  findall(X, between(1, NumArgs, X), ArgdIds),
  NumArgs0 is NumArgs - 1,
  findall(X, between(0, NumArgs0, X), ArgdIds0),
  maplist(varn, ArgdIds, ArgList),
  maplist(bindings, ArgList, NewBindings),
  NewGoal =.. [H|ArgList],
  format(atom(NewGoalStr), '~w', [NewGoal]),
  (atom_to_term(NewGoalStr, NewGoalTerm, NewBindings)
  -> true; atom_to_term(NewGoalStr, NewGoalTerm, _)
  ),

  format(atom(GoalStr), '~w', [Goal]),

  (\+(
      predicate_property(NewGoalTerm, built_in);
      var(H);
      string(H);
      integer(H);
      H = 'member';
      H = 'include';
      H = 'exclude';
      H = 'analyze';
      H = 'ask';
      H = 'new_context';
      H = 'foreach';
      H='\\+';
      H='+';
      H='-';
      H='/';
      H='*';
      H=':-';
      H='-->';
      H='wait_for_input';
      H='observation';
      H='plogchain';
      H='yield';
      H='end_thinking';
      H='answer';
      H='append';
      H='tool';
      H='chat';
      H='system';
      H='is';
      H='user';
      H='get_memory';
      H='set_memory';
      H='clear_memory';
      H='maplist';
      H='generate';
      H='foldl'
      %current_predicate(Module:H/NumArgs)
  ) -> (
    %write("Adding new predicate as LLM call:"), 
    %write(NewGoalStr :- llm(NewGoalStr)),nl, 

    (NumArgs > 0 
      -> 
        (
     
          findall(X, variable_assignments(X), OriginalBindings),
          with_output_to(atom(GoalStr), write_term(Goal, [quoted(true)])),
          term_variables(Goal, Vars),
          include(var_in_bindings(Vars), OriginalBindings, TermBindings),
          atom_to_term(GoalStr, GoalTerm, TermBindings),
          with_output_to(atom(GoalTermStr), write_term(GoalTerm, [quoted(true)]))
          %retractall(Module:def(H, _))
          %assertz(Module:def(H, GoalTermStr)) %TODo make this dependent on the session id, as well as the arity 
        )
      ;
          true
      ),

      
      (NumArgs == 0, \+is_user_rule(Module, H) ) -> (
        with_output_to(string(Expl), write_term(RuleExplanationString, [quoted(true), character_escapes(true)])),
        assertz(
      (Module:NewGoalTerm :- 
              (catch(
                (llm_evaluate_goal(Module, Context, Memory, NewGoalStr, Response, Expl), 
                 get_dict('result', Response, true)),
                
                 Error, (yield('"\\n\\n**ERROR:\\n\\n"'), yield(Error), fail)),!
              )
          )), 
          
          true
          %assertz(Module:def(H, NewGoalTerm))
          
          )
      ;

      length(AssignmentsList, NumArgs),
      length(R, NumArgs),
      maplist(=(Response), R),
      length(SS, NumArgs),
      maplist(=(S), SS),
      zip(R,SS, RSS),
      maplist(assignment_term, RSS, ArgdIds0,ArgList,  AssignmentsList),
      list_to_conjunction(AssignmentsList, Assignments),

      with_output_to(string(Expl), write_term(RuleExplanationString, [quoted(true), character_escapes(true)])),

      format(atom(RStr), '~w', 
        [NewGoalTerm :- %Substitute this with a rule that just returns the rule name and original context, rst in MI?
          (
              catch((llm_evaluate_goal(Module, Context, Memory, NewGoalStr, Response, Expl), 
              get_dict('result', Response, true),
              get_dict('variable_assignments', Response, VA),
              length(VA, NumAssignments), NumAssignments > 0,
              NumAssignments0 is NumAssignments-1,
              between(0, NumAssignments0,S ), 
              (Assignments)), Error, (yield('"\\n\\n**ERROR:\\n\\n"'), yield(Error), fail)),! 
          )
        ]
      ),
   
      atom_to_term(RStr, Term,_),

      retractall(NewGoalTerm),
      (\+is_user_rule(Module, H) -> (assertz((Module:Term)));true)
    )
    ;
    true).


get_user_rules(Module, Context, Memory, GoalStr, Result) :-
open_string(GoalStr, Stream),
  repeat,
 
  read_expand_clause(Stream, Goal, Bindings),
  %read_clause(Stream, Goal, [variable_names(Bindings), module(clpfd)]),
 
  save_bindings(Bindings),
  %writeln(Goal),
  (
    Goal \= end_of_file  
  ->
    (
      (
        Goal = (A:-B)
      ->
          (
            (B \= (format(_,Txt,_),@(_)), B \= @(Txt))
          ->
            A =.. [RuleName|_],
            %write("(1) Found user rule "), write(RuleName), nl,
            assertz(is_user_rule(Module, RuleName))
          ;
            (
              A \= 'agent_main' 
            ->

              (B = (format(_,Txt,_),@(_));B= @(Txt)),
              dml_strings:dml_string_constant_expansion(Txt, Txt0),
              %writeln("After expansion"),
              %writeln(Txt0),
              A =.. [RuleName|_],
              with_output_to(string(GoalDef), write_term(A, [variable_names(Bindings)])),
              format(string(TxtStr), '"~w: ~w"',[GoalDef, Txt0]), 

              %writeln((A,Txt)),
              assertz(Module:def(RuleName, GoalDef)),
              add_llm_rule(Module, Context, Memory, A, TxtStr)),
  
              assertz(is_llm_rule(Module, RuleName))
            ;
              true
            )
      ;
          Goal =.. [RuleName|_],
          %write("(2) Found user rule "), write(RuleName), nl,
          assertz(is_user_rule(Module, RuleName)),
          %write("Asserting rule "), write(Goal), nl,
          assertz((Module:Goal)),
          true
      )
      
    ),
    fail 
    ;
    true 
  ),
  !.


parse_goal(Module, Context, Memory, GoalStr, ErrorMsg) :-
  catch(
    (
      
      writeln("Parsing user rules"),
      get_user_rules(Module, Context, Memory, GoalStr, Result),
      writeln("Parsing finished"),
      open_string(GoalStr, Stream),
      repeat,
       

      catch(
        %read_clause(Stream, Goal, [variable_names(Bindings),syntax_errors(error), module(clpfd)]),
        read_expand_clause(Stream, Goal, Bindings),

        ErrorInner,
        (writeln(ErrorInner),true)
      ),

      writeln(Goal),

      (
        var(Goal) -> throw("Parser error");true
      ),
      (
        Goal \= end_of_file
      -> 
        
        save_bindings(Bindings),
        (
          (Goal = (A:-B), B \= @(_)) 
        -> 
          analyze(Module, Context, Memory, Goal, GoalRewrite)
        ;
          true
        ),
        fail
        ;
        true
      )
    ),
    Error,
    (
      format(string(ErrorMsg), "ERROR: Plogchain code could not be parsed: ~w", [Error])
    )
  ).

plogchain(Module, Context, Memory, GoalStr, Params, Result) :-
  Module:import(plogchain:yield/1),
  Module:import(plogchain:wait_for_input/2),
  Module:import(plogchain:llm_evaluate_goal/6),
  Module:import(plogchain:get_assignment/4),

  Module:import(cmdline:run_dml_async/2),
  Module:import(cmdline:run_dml_file_async/2),


  writeln("Calling agent main"),
  catch(
    (
      listing(Module:_),
      once(mi(Module:agent_main, Memory, Context, Module, Params))
    ->
      Result = "\n\n:- **Agent exited normally.**"
    ;
      Result = "\n\n:- **Agent failed to achieve Goal.**"
    ),
    Error,
    (
      format(string(Result),"\n\n:- **Agent failed to achieve Goal. Error: ~w**", [Error])
    )
  ).
  %mi(Module:agent_main, Memory, Context, Module).


ask(Module, Context, Memory, Question, Result) :-
  question_to_goal(Question, Goal, Bindings),
  format(string(GoalStr), '~w', [Goal]),
  get_user_rules(Module, Context, Memory, GoalStr, Result),
 
  open_string(GoalStr, Stream),
  repeat,
  read_clause(Stream, Goal, [variable_names(Bindings)]),
  (
    Goal \= end_of_file  
  -> 
   
    save_bindings(Bindings),
      
    analyze(Module, Context, Memory, Goal, GoalRewrite),
    fail
    ;
    true
  ),
  writeln('Analysis finished'),
  !, 
  Module:import(plogchain:yield/1),
  Module:import(plogchain:wait_for_input/2),
  Module:import(plogchain:tool/2),
  Module:import(plogchain:chat/1),
  Module:import(plogchain:llm_evaluate_goal/6),
  Module:import(plogchain:get_assignment/4),
  writeln("Calling agent main"),
  call(mi(Module:agent_main, Memory,Context, Module)).


%
% Memory related functions
%

memory_engine(Memory) :-
  engine_fetch(Command),
  memory_command(Command, Memory, NewMemory),
  memory_engine(NewMemory).

memory_command(store(NewMemoryItem), Memory, NewMemory) :-
    append(Memory, [NewMemoryItem], NewMemory),
    engine_yield(true).

memory_command(pop_item, Memory, NewMemory) :-
    reverse(Memory, Reversed),
    Reversed = [H|T], 
    reverse(T, NewMemory),
    engine_yield(true).

memory_command(clear, Memory, NewMemory) :-
    NewMemory = [],
    engine_yield(true).

memory_command(set(Content), Memory, NewMemory) :-
    NewMemory = Content,
    engine_yield(true).

memory_command(Command, Memory, NewMemory) :-
    NewMemory = Memory,
    engine_yield(Memory).

push_memory(Handle, Data) :-
  %with_output_to(string(DataStr), write_term(Data, [quoted(true)])),
   engine_post(Handle, store(Data), Memory).

fetch_memory(Handle, L) :-
   engine_post(Handle, readall, L).

set_memory(Handle, L) :-
   engine_post(Handle, set(L), _).

clear_memory(Handle) :-
   engine_post(Handle, clear, _).

push_context(Context, Data) :-
  with_output_to(string(DataStr), write_term(Data, [quoted(true)])),
  format(atom(RuleHead), '~w(~w)', [Context,DataStr]),
  atom_to_term(RuleHead, Rule, _),
  assertz(Rule).

create_memory(Handle) :-
   engine_create(_, memory_engine([]), Handle).

create_memory(Handle, Content) :-
   engine_create(_, memory_engine(Content), Handle).

delete_memory(Handle) :-
   engine_destroy(Handle).


 %
 % The PlogChain Meta Interpreter
 %

 mi(true, Memory, Context, Session, Params) :- true.
 mi((A,B), Memory, Context, Session, Params) :-   mi(A,Memory, Context, Session, Params),mi(B, Memory, Context, Session, Params).
 mi((A->B;C), Memory, Context, Session, Params) :-   (mi(A,Memory, Context, Session, Params)->mi(B, Memory, Context, Session, Params);mi(C, Memory, Context, Session, Params)),!.
 mi((A;B), Memory, Context, Session, Params) :-   ( mi(A,Memory, Context, Session, Params);mi(B, Memory, Context, Session, Params)).
 mi((A->B), Memory, Context, Session, Params) :-  ( mi(A,Memory, Context, Session, Params)->mi(B, Memory, Context, Session, Params)).
 mi(\+A, Memory, Context, Session, Params) :- \+mi(A, Memory, Context, Session, Params).

 mi(tool(A,B), Memory, Context, Session, Params) :-
   yield(tool_call=(A)),
   (
       exec_tool(A,B, Memory, Session)
   -> 
       true
   ;
     yield(error="Tool call failed."),
     fail
   ).
       
 mi(plogchain:tool(A,B), Memory, Context, Session, Params) :-
   mi(tool(A,B), Memory, Context). 

 mi(chat(A), Memory, Context, Session, Params) :-
   %yield(instruction=(A)),
   exec_chat(A, Response, Memory).

 mi(chat(A,B), Memory, Context, Session, Params) :-
   %yield(instruction=(A)),
   exec_chat(A, Response, Memory),
   B = Response.

 mi(generate(A,B), Memory, Context, Session, Params) :-
   %yield(instruction=(A)),
   exec_generation(A, B).
 
 mi(push(A), Memory, Context, Session, Params) :-
   format(string(MemoryStr), '~w', [A]),
   push_context(Context, MemoryStr),
   exec_push(message{role: 'assistant', content: MemoryStr}, Memory).

 mi(observation(A), Memory, Context, Session, Params) :-
   format(string(MemoryStr), 'Assistant:\n Observation: ~w', [A]),
   push_context(Context, MemoryStr),
   exec_push(message{role: 'assistant', content: MemoryStr}, Memory).

 mi(user(A), Memory, Context, Session, Params) :-
   format(string(MemoryStr), '~w', [A]),
   exec_push(message{role: 'user', content: MemoryStr}, Memory).

 mi(system(A), Memory, Context, Session, Params) :-
   format(string(MemoryStr), '~w', [A]),
   exec_push(message{role: 'system', content: MemoryStr}, Memory).

 mi(findall(A,B,C), Memory, Context, Session, Params) :-
  
   findall(A, call(mi(B, Memory, Context, Session, Params)), C).

 mi(maplist(A,B,C), Memory, Context, Session, Params) :-   
   mi_maplist_(Memory, Context, Session, Params, B,C,A), !.

 mi(maplist(A,B,C), Memory, Context, Session, Params) :-   
   mi_maplist__(Memory, Context, Session, Params, B,C,A).

 mi(maplist(A,B,C,D), Memory, Context, Session, Params) :-   
   mi_maplist_(Memory, Context, Session, Params, B,C,D, A).

 mi(maplist(A,B,C,D,E), Memory, Context, Session, Params) :-   
   mi_maplist_(Memory, Context, Session, Params, B,C,D,E,A).

 mi(include(A,B,C), Memory, Context, Session, Params) :-
   mi_include_(Memory, Context, Session, Params, B,A,C), !.

 mi(include(A,B,C), Memory, Context, Session, Params) :-
   mi_include__(Memory, Context, Session, Params, B,A,C).

 mi(exclude(A,B,C), Memory, Context, Session, Params) :-
   mi_exclude_(Memory, Context, Session, Params, B,A,C),!.

 mi(exclude(A,B,C), Memory, Context, Session, Params) :-
   mi_exclude__(Memory, Context, Session, Params, B,A,C).



 mi(foldl(A,B,C,D), Memory, Context, Session, Params) :-
   mi_foldl_(Memory, Context, Session, Params, A,B,C,D),!.

 mi(foldl(A,B,C,D), Memory, Context, Session, Params) :-
   mi_foldl__(Memory, Context, Session, Params, A,B,C,D).

 mi(foldl(A,B,C,D, E), Memory, Context, Session, Params) :-
   mi_foldl_(Memory, Context, Session, Params, A,B,C,D, E),!.

 mi(foldl(A,B,C,D, E), Memory, Context, Session, Params) :-
   mi_foldl__(Memory, Context, Session, Params, A,B,C,D, E).

 mi(format(A,B,C), Memory, Context, Session, Params) :-

  writeln(format(A,B,C)),
   catch(format(A,B,C),
    Error,
    (yield(log>"Warning: format failed. Assuming unformatted write."),
     write(A,B)
    )
   ).

 mi(format(A,B), Memory, Context, Session, Params) :-
   writeln(format(A,B)),
   catch(format(A,B,[]),
    Error,
    (yield(log>"Warning: format failed. Assuming unformatted write."),
     write(A,B)
    )
   ).

 mi(yield(A), Memory, Context, Session, Params) :-
   yield(A).

  mi(answer(A), Memory, Context, Session, Params) :-
    answer(A).

  mi(get_memory(X), Memory, Context, Session, Params) :-
    fetch_memory(Memory, X).

  mi(set_memory(X), Memory, Context, Session, Params) :-
    set_memory(Memory, X).

  mi(clear_memory, Memory, Context, Session, Params) :-
    clear_memory(Memory).

  mi(call(A), Memory, Context, Session, Params) :-
    call(mi(A, Memory, Context, Session, Params)).
  
  mi(once(A), Memory, Context, Session, Params) :-
    once(mi(A, Memory, Context, Session, Params)).


  mi(end_thinking, Memory, Context, Session, Params) :-
  
    %py_call(bridge:'result_system_prompt'(), ResultSystemPrompt),
    %#exec_push({role: 'system', content: ResultSystemPrompt}, Memory),

    end_thinking.
 
  mi(wait_for_input(A,B), Memory, Context, Session, Params) :-
    wait_for_input(A,B).

  mi(yield(A,B), Memory, Context, Session, Params) :-
    format(string(WhatStr), A, B),
    yield(WhatStr).

  mi(Goal, Memory, Context, Session, Params) :-
    mi_eq_str_atom(Goal, Memory, Context, Session, Params).

  mi(Goal, Memory, Context, Session, Params) :-
    mi_neq_str_atom(Goal, Memory, Context, Session, Params).

  mi(downcase_atom(A, B), Memory, Context, Session, Params) :-
    B =.. L,   L=[:,X,Y], downcase_atom(A,Y).


%% Intercept IO
mi(open(string(A),_:B,C), Memory, Context, Session, Params) :-
  %Adjust file path here
  get_workspace_path(Params, WorkspacePath),
  catch(make_directory(WorkspacePath), _, true),
  format(string(FilePath), '~w/~w', [WorkspacePath,A]),
  (B == write -> ensure_directory_exists(FilePath);true),
  yield(open=(FilePath,B,C)),

  open(FilePath,B,C),!.

mi(open(string(A),_:B,C,D), Memory, Context, Session, Params) :-
  %Adjust file path here
  get_workspace_path(Params, WorkspacePath),
  catch(make_directory(WorkspacePath), _, true),
  format(string(FilePath), '~w/~w', [WorkspacePath,A]),
  yield(open=(FilePath,B,C)),
  (B == write -> ensure_directory_exists(FilePath);true),
  open(FilePath,B,C),!.


mi(open(A,_:B,C), Memory, Context, Session, Params) :-

  %Adjust file path here
  get_workspace_path(Params, WorkspacePath),
  catch(make_directory(WorkspacePath), _, true),
  format(string(FilePath), '~w/~w', [WorkspacePath,A]),
  yield(open=(FilePath,B,C)),
  (B == write -> ensure_directory_exists(FilePath);true),
  open(FilePath,B,C),!.

mi(open(A,_:B,C,D), Memory, Context, Session, Params) :-

  %Adjust file path here
  get_workspace_path(Params, WorkspacePath),
  catch(make_directory(WorkspacePath), _, true),
  format(string(FilePath), '~w/~w', [WorkspacePath,A]),
  yield(open=(FilePath,B,C)),
  (B == write -> ensure_directory_exists(FilePath);true),
  open(FilePath,B,C),!.

mi(open(A,B,C), Memory, Context, Session, Params) :-

  %Adjust file path here
  get_workspace_path(Params, WorkspacePath),
  catch(make_directory(WorkspacePath), _, true),
  format(string(FilePath), '~w/~w', [WorkspacePath,A]),
  yield(open=(FilePath,B,C)),
  (B == write -> ensure_directory_exists(FilePath);true),
  open(FilePath,B,C),!.

mi(open(A,B,C,D), Memory, Context, Session, Params) :-

  %Adjust file path here
  get_workspace_path(Params, WorkspacePath),
  catch(make_directory(WorkspacePath), _, true),
  format(string(FilePath), '~w/~w', [WorkspacePath,A]),
  yield(open=(FilePath,B,C)),
  (B == write -> ensure_directory_exists(FilePath);true),
  open(FilePath,B,C,D),!.

mi(close(A), Memory, Context, Session, Params) :- 
  yield(close=A),  
  close(A),!.

mi(exists_file(A), Memory, Context, Session, Params) :- 
  get_workspace_path(Params, WorkspacePath),
  format(string(FilePath), '~w/~w', [WorkspacePath,A]),
  writeln(exists_file(FilePath)),
  exists_file(FilePath),!.

mi(setup_call_cleanup(A, B, C), Memory, Context, Session, Params) :-
  setup_call_cleanup(
    mi(A, Memory, Context, Session, Params),
    mi(B, Memory, Context, Session, Params),
    mi(C, Memory, Context, Session, Params)
  ),!.


% TODO open/4
% TODO setup_call_cleanup/3


mi(read_string(A,B,C), Memory, Context, Session, Params) :-
  read_string(A,B,C), !.


mi(directory_files(Dir, Files), Memory, Context, Session, Params) :-
  get_workspace_path(Params, WorkspacePath),
  format(string(Dir0), '~w/~w', [WorkspacePath, Dir]),
  directory_files(Dir0, Files), !.


mi(make_directory(Dir), Memory, Context, Session, Params) :-
  get_workspace_path(Params, WorkspacePath),
  format(string(DirPath), '~w', [WorkspacePath]),
  catch(make_directory(DirPath), _, true),
  format(string(Dir0), '~w/~w', [WorkspacePath, Dir]),
  catch(make_directory(Dir0), Error, (
    format(string(ErrorMsg), "error=\"WARNING: Could not create directory ~w: ~w\"", [Dir0, Error]),
    yield(log>ErrorMsg)
  )), !.


mi(atomic_list_concat(A,B,C), Memory, Context, Session, Params) :-
  string(B),
  catch(atom_string(BAtom,B),_,fail),
  catch(atomic_list_concat(A,BAtom,C), Error, fail), !.

mi(atomic_list_concat(A,B,C), Memory, Context, Session, Params) :-
  string(B),
  catch(maplist(string_to_atom, A, AAtom),_,fail),
  catch(atom_string(BAtom,B),_,fail),
  catch(atomic_list_concat(Atom,BAtom,C), Error, fail), !.

mi(atomic_list_concat(A,B,C), Memory, Context, Session, Params) :-
  atom(B),
  catch(maplist(string_to_atom, A, AAtom),_,fail),
  catch(atomic_list_concat(AAtom,B,C), Error, fail), !.

mi(atomic_list_concat(A,B,C), Memory, Context, Session, Params) :-
  string(B),
  catch(maplist(compound_to_atom, A, AAtom0),_,fail),
  catch(atom_string(BAtom, B),_,fail),
  catch(atomic_list_concat(AAtom0,BAtom,C), Error, fail).


mi(use_module(library(_:X)), Memory, Context, Session, Params) :-
  use_module(library(X)),!.

mi(reverse(X,Y), Memory, Context, Session, Params) :-
  lists:reverse(X,Y),!.

mi(flatten(X,Y), Memory, Context, Session, Params) :-
  lists:flatten(X,Y),!.

mi(log(A, [H|T]), Memory, Context, Session, Params) :-
  format(string(AStr), '~w', [A]),
  format(string(LogStr), AStr, [H|T]),
  yield(log>LogStr).

mi(log(A), Memory, Context, Session, Params) :-
  yield(log>A).


mi(param(Key, Description, Value), Memory, Context, Session, Params) :-
  writeln(param(Key,Description,Value)),
  atom_string(KeyAtom, Key),
  catch(
    Value = Params.KeyAtom,
    Error,
    (
      (   state_params(Session, Key, Value) -> 
          
          true
      ;
          % Parse parameter type from Key (e.g., "name:file" or "option:select(a,b,c)")
          (   atom_concat(ParamName, TypeSuffix, KeyAtom),
              atom_concat(':', TypeSpec, TypeSuffix)
          ->  % Has type specification
              format(string(PromptWithType), '~w|||~w|||~w', [Description, KeyAtom, TypeSpec]),
              wait_for_input(PromptWithType, Value)
          ;   % No type specification, use standard text input
              wait_for_input(Description, Value)
          ),
          assertz(state_params(Session, Key, Value)) 
      )
    )
  ),
  \+var(Value),
  format(string(ParamStr), 'Parameter: ~w, Description: ~w, Value: ~w', [Key, Description, Value]),
  yield(log>ParamStr).


mi(consult(File), Memory, Context, Session, Params) :-
  %read the file from the workspace and assert its contents as facts
  get_workspace_path(Params, WorkspacePath),
  format(string(FilePath), '~w/~w', [WorkspacePath, File]),
  writeln(consulting(FilePath)),
  consult(FilePath),
  %read_file_to_terms(FilePath, Terms, []),
  %writeln(Terms),
  %need to assert each term into the current module using the Session  TODO
  %forall(member(Term, Terms),
   %      assertz((plogchain:Term))
    %    ),
    %  listing(Session:_), 
  %maplist(assertz, Terms),
   writeln(done).


mi(read_file_to_string(File, Content, Options), Memory, Context, Session, Params) :-
  %read a file from the workspace and unify its contents with Content
  get_workspace_path(Params, WorkspacePath),
  format(string(FilePath), '~w/~w', [WorkspacePath, File]),
  readutil:read_file_to_string(FilePath, Content, Options), !.


 % Handle other rules
 mi(Goal, Memory, Context, Session, Params) :-


  Goal \= true,
  Goal \= (_,_),
  Goal \= (_;_),
  Goal \= (_->_;_),
  Goal \= (_->_),
  Goal \= tool(_,_),
  Goal \= chat(_),
  Goal \= chat(_,_),
  Goal \= push(_),
  Goal \= observation(_),
  Goal \= user(_),
  Goal \= system(_),
  %Goal \= assertz(_),
  Goal \= _:agent_main,

  Goal \= findall(_,_,_),
  Goal \= format(_,_,_),
  Goal \= format(_,_),
  Goal \= yield(_),
  Goal \= answer(_),
  Goal \= get_memory(_),
  Goal \= set_memory(_),
  Goal \= wait_for_input(A,B),
  Goal \= end_thinking,
  Goal \= maplist(_,_,_),
  Goal \= maplist(_,_,_,_),
  Goal \= maplist(_,_,_,_,_),
  Goal \= include(_,_,_),
  Goal \= exclude(_,_,_),
  \+(mi_eq_str_atom_g(Goal)),
  \+(mi_neq_str_atom_g(Goal)),

  Goal \= log(_),
  Goal \= log(_,_),

  Goal \= \+(_),
  Goal \= param(_,_,_),
  Goal \= read_file_to_string(_,_,_),
  Goal \= call(_),
  Goal \= once(_),
  Goal \= make_directory(_),
  Goal \= open(_,_,_),
  Goal \= open(_,_,_,_),
  Goal \= close(_),
  Goal \= directory_files(_, _),

  Goal \= run_dml(_, _),
  Goal \= run_dml_file(_, _),
  Goal \= clear_memory,

  Goal \= foldl(_,_,_),
  Goal \= foldl(_,_,_,_),
  Goal \= foldl(_,_,_,_,_),
  Goal \= foldl(_,_,_,_,_,_),

  Goal \= generate(_,_),

  Goal \= consult(_),

  %print_message(information, check_other_rule(Goal)),
  %not a user rule and not an llm rule
  \+mi_check_user_rule(Goal, Session),
  \+mi_check_llm_rule(Goal, Session),
 
  
  %shorten for output
  (
    Goal =.. L, 
    L  = [:,_,Goal0], 
    Goal0 =.. LL,
    LL=[Goal1|T]
  ->  
    GoalName = Goal1
  ;
    GoalName = Goal
  ),

  %writeln(is_other_rule(Goal)),
  %Goal =.. LLL,
  %writeln(LLL),

  %yield(exec=(GoalName)),
  (
    catch(safe_goal(Goal), Error, true) -> true
  ; 
    yield(Goal),yield("is not a safe goal"), fail
  ),
  catch(Goal,Error, (writeln(Error),fail)).
  %(
  %    (
 %       catch(Goal,Error, (writeln(Error),fail)) 
%
  %    )
 % ;
 %   (
% 
  %        \+(catch(Goal,Error, (writeln(Error),fail))),
 % 
   %       %yield(exec_result=fail),
   %       fail
   % )
  %).


mi(run_dml(A, Output), Memory, Context, Session, Params) :-
  writeln("Running DML"),
  cmdline:run_dml_async(A, Output).

mi(run_dml_file(A, Output), Memory, Context, Session, Params) :-
  writeln("Running DML File"),
  cmdline:run_dml_file_async(A, Output).

mi(Goal, Memory, Context, Session, Params) :-

  %llm rule

  Goal \= true,
  Goal \= (_,_),
  Goal \= (_;_),
  Goal \= (_->_;_),
  Goal \= (_->_),
  Goal \= tool(_,_),
  Goal \= chat(_),
  Goal \= chat(_,_),
  Goal \= push(_),
  Goal \= observation(_),
  Goal \= user(_),
  Goal \= system(_),
  %Goal \= assertz(_),

  Goal \= findall(_,_,_),
  Goal \= format(_,_,_),
  Goal \= format(_,_),
  Goal \= yield(_),
  Goal \= answer(_),
  Goal \= get_memory(_),
  Goal \= set_memory(_),
  Goal \= wait_for_input(A,B),
  Goal \= end_thinking,
  Goal \= maplist(_,_,_),
  Goal \= maplist(_,_,_,_),
  Goal \= maplist(_,_,_,_,_),
  Goal \= include(_,_,_),
  Goal \= exclude(_,_,_),
  \+(mi_eq_str_atom_g(Goal)),
  \+(mi_neq_str_atom_g(Goal)),

  Goal \= read_file_to_string(_,_,_),
  Goal \= log(_),
  Goal \= log(_, _),
  Goal \= \+(_),
  Goal \= param(_,_,_),
  Goal \= call(_),
  Goal \= once(_),
  Goal \= make_directory(_),
  Goal \= open(_,_,_),
  Goal \= open(_,_,_,_),
  Goal \= close(_),
  Goal \= directory_files(_, _),

  Goal \= run_dml(_, _),
  Goal \= run_dml_file(_, _),

  Goal \= foldl(_,_,_),
  Goal \= foldl(_,_,_,_),
  Goal \= foldl(_,_,_,_,_),
  Goal \= foldl(_,_,_,_,_,_),

  Goal \= generate(_,_),

  Goal \= clear_memory,

  Goal \= consult(_),

  mi_check_llm_rule(Goal, Session),

  Goal =.. L,
  (L = [:,Session,_] ->
    ExecGoal = Goal
  ;
    ExecGoal = Session:Goal
  ),

  %shorten for output
  (
    Goal =.. L, 
    L  = [:,_,Goal0], 
    Goal0 =.. LL,
    LL=[Goal1|T]
  ->  
    GoalName = Goal1
  ;
    GoalName = Goal
  ),

  yield(exec=(GoalName)),
  catch(ExecGoal, Error, (yield(exec_result=fail),fail)).
  %(
  %    (ExecGoal)
  %;
   % (
   %       \+(ExecGoal),
   %     
   %      yield(exec_result=fail),
   %       fail
   % )
  %).


 % Handle user rules
 mi(Goal, Memory, Context, Session, Params) :-
  Goal \= true,
  Goal \= (_,_),
  Goal \= (_;_),
  Goal \= (_->_;_),
  Goal \= (_->_),
  Goal \= tool(_,_),
  Goal \= chat(_),
  Goal \= chat(_,_),
  Goal \= push(_),
  Goal \= observation(_),
  Goal \= user(_),
  Goal \= system(_),
  %Goal \= assertz(_),

  Goal \= findall(_,_,_),
  Goal \= format(_,_,_),
  Goal \= format(_,_),
  Goal \= yield(_),
  Goal \= answer(_),
  Goal \= get_memory(_),
  Goal \= set_memory(_),
  Goal \= wait_for_input(A,B),
  Goal \= end_thinking,
  Goal \= maplist(_,_,_),
  Goal \= maplist(_,_,_,_),
  Goal \= maplist(_,_,_,_,_),
  Goal \= include(_,_,_),
  Goal \= exclude(_,_,_),
  \+(mi_eq_str_atom_g(Goal)),
  \+(mi_neq_str_atom_g(Goal)),

  Goal \= log(_),
  Goal \= log(_, _),
  Goal \= \+(_),
  Goal \= param(_,_,_),
  Goal \= call(_),
  Goal \= once(_),
  Goal \= make_directory(_),
  Goal \= open(_,_,_),
  Goal \= open(_,_,_,_),
  Goal \= close(_),
  Goal \= directory_files(_, _),

  Goal \= run_dml(_, _),
  Goal \= run_dml_file(_, _),

  Goal \= foldl(_,_,_),
  Goal \= foldl(_,_,_,_),
  Goal \= foldl(_,_,_,_,_),
  Goal \= foldl(_,_,_,_,_,_),

  Goal \= clear_memory,

  Goal \= generate(_,_),
  Goal \= consult(_),

  Goal \= read_file_to_string(_,_,_),
  mi_check_user_rule(Goal, Session),

 

  Goal =.. L,
  (L = [:,Session,_] ->
    ExecGoal = Goal
  ;
    ExecGoal = Session:Goal
  ),

  ( 
    (clause(ExecGoal, plogchain:Body),
    %yield(exec=ExecGoal),
      mi(Body, Memory, Context, Session, Params))
    
  ;
    clause(ExecGoal, true)
  ).

    
mi_maplist_(Memory, Context, Session, Params,[], [], _).
mi_maplist_(Memory, Context, Session, Params,[Elem1|Tail1], [Elem2|Tail2], Goal) :-
    Goal =.. L,
    L  = [:,_,Goal0], 
    Goal0 =.. LL,
    LL = [Goal1|Args],
    append(Args, [Elem1, Elem2], NewArgs),
    NewGoal =.. [Goal1|NewArgs],
    NewGoal2 =.. [:,Session,NewGoal],
    mi(NewGoal2, Memory, Context, Session, Params),
    mi_maplist_(Memory, Context, Session, Params, Tail1, Tail2, Goal).


mi_maplist__(Memory, Context, Session, Params,[], [], _).
mi_maplist__(Memory, Context, Session, Params, [Elem1|Tail1], [Elem2|Tail2], Goal) :-
    
    Goal =.. L,
    L  = [Goal0|Args], 
    append(Args, [Elem1, Elem2], NewArgs),
    NewGoal =.. [Goal0|NewArgs],

    mi(NewGoal, Memory, Context, Session, Params),
    mi_maplist__(Memory, Context, Session, Params, Tail1, Tail2, Goal).



mi_maplist_(Memory, Context, Session, Params,[], [], [], _).
mi_maplist_(Memory, Context, Session, Params,[Elem1|Tail1], [Elem2|Tail2], [Elem3|Tail3], Goal) :-
    Goal =.. L,
    L  = [:,_,Goal0], 
    NewGoal =.. [Goal0,Elem1, Elem2, Elem3],
    NewGoal2 =.. [:,Session,NewGoal],
    mi(NewGoal2, Memory, Context, Session, Params),
    mi_maplist_(Memory, Context, Session, Params, Tail1, Tail2, Tail3, Goal).

mi_maplist_(Memory, Context, Session, Params,[], [], [], [], _).
mi_maplist_(Memory, Context, Session, Params,[Elem1|Tail1], [Elem2|Tail2], [Elem3|Tail3],  [Elem4|Tail4], Goal) :-
    Goal =.. L,
    L  = [:,_,Goal0], 
    NewGoal =.. [Goal0,Elem1,Elem2, Elem3, Elem4],
    NewGoal2 =.. [:,Session,NewGoal],
    mi(NewGoal2, Memory, Context, Session, Params),
    mi_maplist_(Memory, Context, Session, Params, Tail1, Tail2, Tail3, Tail4, Goal).




mi_include_(Memory, Context, Session, Params, [], _, []).
mi_include_(Memory, Context, Session, Params, [X1|Xs1], Goal, Included) :-

    Goal =.. L,
    L  = [:,_,Goal0], 
    NewGoal =.. [Goal0,X1],
    NewGoal2 =.. [:,Session,NewGoal],

    (   mi(NewGoal2, Memory, Context, Session, Params)
    ->  Included=[X1|Included1]
    ;   Included=Included1
    ),
    mi_include_(Memory, Context, Session, Params, Xs1, Goal, Included1).


mi_exclude_(Memory, Context, Session, Params, [], _, []).
mi_exclude_(Memory, Context, Session, Params, [X1|Xs1], Goal, Included) :-

    Goal =.. L,
    L  = [:,_,Goal0], 
    NewGoal =.. [Goal0,X1],
    NewGoal2 =.. [:,Session,NewGoal],

    (   mi(NewGoal2, Memory, Context, Session, Params)
    ->  Included=Included1
    ;   Included=[X1|Included1]
    ),
    mi_exclude_(Memory, Context, Session, Params, Xs1, Goal, Included1).



mi_include__(Memory, Context, Session, Params, [], _, []).
mi_include__(Memory, Context, Session, Params, [X1|Xs1], Goal, Included) :-

    Goal =.. L,
    L  = [Goal0|Args], 
    append(Args, [X1], NewArgs),
    NewGoal =.. [Goal0|NewArgs],

   
    (   mi(NewGoal, Memory, Context, Session, Params)
    ->  Included=[X1|Included1]
    ;   Included=Included1
    ),
    mi_include__(Memory, Context, Session, Params, Xs1, Goal, Included1).


mi_exclude__(Memory, Context, Session, Params, [], _, []).
mi_exclude__(Memory, Context, Session, Params, [X1|Xs1], Goal, Included) :-

    Goal =.. L,
    L  = [Goal0|Args], 
    append(Args, [X1], NewArgs),
    NewGoal =.. [Goal0|NewArgs],



    (   mi(NewGoal, Memory, Context, Session, Params)
    ->  Included=Included1
    ;   Included=[X1|Included1]
    ),
    mi_exclude__(Memory, Context, Session, Params, Xs1, Goal, Included1).


mi_foldl_(Memory, Context, Session, Params, _, [], V, V).
mi_foldl_(Memory, Context, Session, Params, Goal, [Elem|Tail], V0, V) :-
    Goal =.. L,
    L  = [:,_,Goal0],
    NewGoal =.. [Goal0, Elem, V0, V1],
    NewGoal2 =.. [:,Session,NewGoal],
    mi(NewGoal2, Memory, Context, Session, Params),
    mi_foldl_(Memory, Context, Session, Params, Goal, Tail, V1, V).

mi_foldl_(Memory, Context, Session, Params, _, [], [], V, V).
mi_foldl_(Memory, Context, Session, Params, Goal, [Elem1|Tail1], [Elem2|Tail2], V0, V) :-
    Goal =.. L,
    L  = [:,_,Goal0],
    NewGoal =.. [Goal0, Elem1, Elem2, V0, V1],
    NewGoal2 =.. [:,Session,NewGoal],
    mi(NewGoal2, Memory, Context, Session, Params),
    mi_foldl_(Memory, Context, Session, Params, Goal, Tail1, Tail2, V1, V).

mi_foldl_(Memory, Context, Session, Params, _, [], [], [], V, V).
mi_foldl_(Memory, Context, Session, Params, Goal, [Elem1|Tail1], [Elem2|Tail2], [Elem3|Tail3], V0, V) :-
    Goal =.. L,
    L  = [:,_,Goal0],
    NewGoal =.. [Goal0, Elem1, Elem2, Elem3, V0, V1],
    NewGoal2 =.. [:,Session,NewGoal],
    mi(NewGoal2, Memory, Context, Session, Params),
    mi_foldl_(Memory, Context, Session, Params, Goal, Tail1, Tail2, Tail3, V1, V).

mi_foldl_(Memory, Context, Session, Params, _, [], [], [], [], V, V).
mi_foldl_(Memory, Context, Session, Params, Goal, [Elem1|Tail1], [Elem2|Tail2], [Elem3|Tail3], [Elem4|Tail4], V0, V) :-
    Goal =.. L,
    L  = [:,_,Goal0],
    NewGoal =.. [Goal0, Elem1, Elem2, Elem3, Elem4, V0, V1],
    NewGoal2 =.. [:,Session,NewGoal],
    mi(NewGoal2, Memory, Context, Session, Params),
    mi_foldl_(Memory, Context, Session, Params, Goal, Tail1, Tail2, Tail3, Tail4, V1, V).

mi_foldl__(Memory, Context, Session, Params, _, [], V, V).
mi_foldl__(Memory, Context, Session, Params, Goal, [Elem|Tail], V0, V) :-
    Goal =.. [Goal0|Args],
    append(Args, [Elem, V0, V1], NewArgs),
    NewGoal =.. [Goal0|NewArgs],
    mi(NewGoal, Memory, Context, Session, Params),
    mi_foldl__(Memory, Context, Session, Params, Goal, Tail, V1, V).

mi_foldl__(Memory, Context, Session, Params, _, [], [], V, V).
mi_foldl__(Memory, Context, Session, Params, Goal, [Elem1|Tail1], [Elem2|Tail2], V0, V) :-
    Goal =.. [Goal0|Args],
    append(Args, [Elem1, Elem2, V0, V1], NewArgs),
    NewGoal =.. [Goal0|NewArgs],
    mi(NewGoal, Memory, Context, Session, Params),
    mi_foldl__(Memory, Context, Session, Params, Goal, Tail1, Tail2, V1, V).

mi_foldl__(Memory, Context, Session, Params, _, [], [], [], V, V).
mi_foldl__(Memory, Context, Session, Params, Goal, [Elem1|Tail1], [Elem2|Tail2], [Elem3|Tail3], V0, V) :-
    Goal =.. [Goal0|Args],
    append(Args, [Elem1, Elem2, Elem3, V0, V1], NewArgs),
    NewGoal =.. [Goal0|NewArgs],
    mi(NewGoal, Memory, Context, Session, Params),
    mi_foldl__(Memory, Context, Session, Params, Goal, Tail1, Tail2, Tail3, V1, V).

mi_foldl__(Memory, Context, Session, Params, _, [], [], [], [], V, V).
mi_foldl__(Memory, Context, Session, Params, Goal, [Elem1|Tail1], [Elem2|Tail2], [Elem3|Tail3], [Elem4|Tail4], V0, V) :-
    Goal =.. [Goal0|Args],
    append(Args, [Elem1, Elem2, Elem3, Elem4, V0, V1], NewArgs),
    NewGoal =.. [Goal0|NewArgs],
    mi(NewGoal, Memory, Context, Session, Params),
    mi_foldl__(Memory, Context, Session, Params, Goal, Tail1, Tail2, Tail3, Tail4, V1, V).


mi_eq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=['==',X,_:Y], atom(X), string(Y), atom_string(X,Y),!.
mi_eq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=['==',X,_:Y], atom(Y), string(X), atom_string(Y,X),!.
mi_eq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=['==',_:X,Y], atom(X), string(Y), atom_string(X,Y),!.
mi_eq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=['==',_:X,Y], atom(Y), string(X), atom_string(Y,X),!.
mi_eq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=['==',_:X,_:Y], atom(X), string(Y), atom_string(X,Y),!.
mi_eq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=['==',_:X,_:Y], atom(Y), string(X), atom_string(Y,X),!.
mi_eq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=['==',_:X,_:Y], atom(X), atom(Y), X=Y,!.
mi_eq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=['==',_:X,_:Y], string(Y), string(X), X=Y,!.


mi_eq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=['==',X,Y], atom(X), string(Y), atom_string(X,Y),!.
mi_eq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=['==',X,Y], atom(Y), string(X), atom_string(Y,X),!.
mi_eq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=['==',X,Y], atom(X), string(Y), atom_string(X,Y),!.
mi_eq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=['==',X,Y], atom(Y), string(X), atom_string(Y,X),!.
mi_eq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=['==',X,Y], atom(X), string(Y), atom_string(X,Y),!.
mi_eq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=['==',X,Y], atom(Y), string(X), atom_string(Y,X),!.
mi_eq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=['==',X,Y], atom(X), atom(Y), X=Y,!.
mi_eq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=['==',X,Y], string(Y), string(X), X=Y,!.


mi_eq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=['==',@(true),true], !.
mi_eq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=['==',true, @(true)], !.
mi_eq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=['==',_: @(true),true], !.
mi_eq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=['==',true, _:  @(true)], !.

mi_neq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=[\=,X,_:Y], atom(X), string(Y), atom_string(X,Z), Z\=Y,!.
mi_neq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=[\=,X,_:Y], atom(Y), string(X), atom_string(Y,Z), Z\=X,!.
mi_neq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=[\=,_:X,Y], atom(X), string(Y), atom_string(X,Z), Z\=Y,!.
mi_neq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=[\=,_:X,Y], atom(Y), string(X), atom_string(Y,Z), Z\=X,!.
mi_neq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=[\=,_:X,_:Y], atom(X), string(Y), atom_string(X,Z), Z\=Y,!.
mi_neq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=[\=,_:X,_:Y], atom(Y), string(X), atom_string(Y,Z), Z\=X,!.
mi_neq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=[\=,_:X,_:Y], atom(X), atom(Y), X\=Y,!.
mi_neq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=[\=,_:X,_:Y], string(Y), string(X), X\=Y,!.

mi_neq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=[\=,X,Y], atom(X), string(Y), atom_string(X,Z), Z\=Y,!.
mi_neq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=[\=,X,Y], atom(Y), string(X), atom_string(Y,Z), Z\=X,!.
mi_neq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=[\=,X,Y], atom(X), string(Y), atom_string(X,Z), Z\=Y,!.
mi_neq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=[\=,X,Y], atom(Y), string(X), atom_string(Y,Z), Z\=X,!.
mi_neq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=[\=,X,Y], atom(X), string(Y), atom_string(X,Z), Z\=Y,!.
mi_neq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=[\=,X,Y], atom(Y), string(X), atom_string(Y,Z), Z\=X,!.
mi_neq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=[\=,X,Y], atom(X), atom(Y), X\=Y,!.
mi_neq_str_atom(Goal, Memory, Context, Session, Params) :- Goal =.. L,   L=[\=,X,Y], string(Y), string(X), X\=Y,!.


mi_eq_str_atom_g(Goal) :- Goal =.. L,   L=['==',X,_:Y], atom(X), string(Y).
mi_eq_str_atom_g(Goal) :- Goal =.. L,   L=['==',X,_:Y], atom(Y), string(X).
mi_eq_str_atom_g(Goal) :- Goal =.. L,   L=['==',_:X,Y], atom(X), string(Y).
mi_eq_str_atom_g(Goal) :- Goal =.. L,   L=['==',_:X,Y], atom(Y), string(X).
mi_eq_str_atom_g(Goal) :- Goal =.. L,   L=['==',_:X,_:Y], atom(X), string(Y).
mi_eq_str_atom_g(Goal) :- Goal =.. L,   L=['==',_:X,_:Y], atom(Y), string(X).
mi_eq_str_atom_g(Goal) :- Goal =.. L,   L=['==',_:X,_:Y], atom(X), atom(Y).
mi_eq_str_atom_g(Goal) :- Goal =.. L,   L=['==',_:X,_:Y], string(Y), string(X).

mi_eq_str_atom_g(Goal) :- Goal =.. L,   L=['==',X,Y], atom(X), string(Y).
mi_eq_str_atom_g(Goal) :- Goal =.. L,   L=['==',X,Y], atom(Y), string(X).
mi_eq_str_atom_g(Goal) :- Goal =.. L,   L=['==',X,Y], atom(X), string(Y).
mi_eq_str_atom_g(Goal) :- Goal =.. L,   L=['==',X,Y], atom(Y), string(X).
mi_eq_str_atom_g(Goal) :- Goal =.. L,   L=['==',X,Y], atom(X), string(Y).
mi_eq_str_atom_g(Goal) :- Goal =.. L,   L=['==',X,Y], atom(Y), string(X).
mi_eq_str_atom_g(Goal) :- Goal =.. L,   L=['==',X,Y], atom(X), atom(Y).
mi_eq_str_atom_g(Goal) :- Goal =.. L,   L=['==',X,Y], string(Y), string(X).

mi_eq_str_atom_g(Goal) :- Goal =.. L,   L=['==',@(true),true].
mi_eq_str_atom_g(Goal) :- Goal =.. L,   L=['==',true, @(true)].
mi_eq_str_atom_g(Goal) :- Goal =.. L,   L=['==',_: @(true),true].
mi_eq_str_atom_g(Goal) :- Goal =.. L,   L=['==',true, _:  @(true)].


mi_neq_str_atom_g(Goal) :- Goal =.. L,   L=[\=,X,_:Y], atom(X), string(Y), atom_string(X,Z).
mi_neq_str_atom_g(Goal) :- Goal =.. L,   L=[\=,X,_:Y], atom(Y), string(X), atom_string(Y,Z).
mi_neq_str_atom_g(Goal) :- Goal =.. L,   L=[\=,_:X,Y], atom(X), string(Y), atom_string(X,Z).
mi_neq_str_atom_g(Goal) :- Goal =.. L,   L=[\=,_:X,Y], atom(Y), string(X), atom_string(Y,Z).
mi_neq_str_atom_g(Goal) :- Goal =.. L,   L=[\=,_:X,_:Y], atom(X), string(Y), atom_string(X,Z).
mi_neq_str_atom_g(Goal) :- Goal =.. L,   L=[\=,_:X,_:Y], atom(Y), string(X), atom_string(Y,Z).
mi_neq_str_atom_g(Goal) :- Goal =.. L,   L=[\=,_:X,_:Y], atom(X), atom(Y).
mi_neq_str_atom_g(Goal) :- Goal =.. L,   L=[\=,_:X,_:Y], string(Y), string(X).


mi_neq_str_atom_g(Goal) :- Goal =.. L,   L=[\=,X,Y], atom(X), string(Y), atom_string(X,Z).
mi_neq_str_atom_g(Goal) :- Goal =.. L,   L=[\=,X,Y], atom(Y), string(X), atom_string(Y,Z).
mi_neq_str_atom_g(Goal) :- Goal =.. L,   L=[\=,X,Y], atom(X), string(Y), atom_string(X,Z).
mi_neq_str_atom_g(Goal) :- Goal =.. L,   L=[\=,X,Y], atom(Y), string(X), atom_string(Y,Z).
mi_neq_str_atom_g(Goal) :- Goal =.. L,   L=[\=,X,Y], atom(X), string(Y), atom_string(X,Z).
mi_neq_str_atom_g(Goal) :- Goal =.. L,   L=[\=,X,Y], atom(Y), string(X), atom_string(Y,Z).
mi_neq_str_atom_g(Goal) :- Goal =.. L,   L=[\=,X,Y], atom(X), atom(Y).
mi_neq_str_atom_g(Goal) :- Goal =.. L,   L=[\=,X,Y], string(Y), string(X).

compound_to_atom(C, A):-
  C=..L,
  L=[:,_,A].


mi_check_user_rule(Goal, Session) :-
  Goal =.. L,
  L  = [:,Session,Goal0], 
  Goal0 =.. LL,
  LL=[Goal1|T],
  is_user_rule(Session, Goal1),
  !.
  
mi_check_user_rule(Goal, Session) :-
  Goal =.. L,
  L  = [Goal0|_], 
  is_user_rule(Session, Goal0),
  ExecL = [:,Session,Goal]
  .

mi_check_llm_rule(Goal, Session) :-
  Goal =.. L,
  L  = [:,Session,Goal0], 
  Goal0 =.. LL,
  LL=[Goal1|T],
  is_llm_rule(Session, Goal1),
  !.
  
mi_check_llm_rule(Goal, Session) :-
  Goal =.. L,
  L  = [Goal0|_], 
  is_llm_rule(Session, Goal0).


try_parse(Val) :-
    read_term_from_atom(Val, XX,[]),
    XX=(X=SomeValue).


%% Helper predicate to get workspace path from Params
get_workspace_path(Params, WorkspacePath) :-
  catch(
    get_dict(workspace_path, Params, WorkspacePath),
    Error,
    (
      wait_for_input("Please provide workspace path: ", WorkspacePath)
    )
  ),
  \+var(WorkspacePath).


ensure_directory_exists(FilePath) :-
    file_directory_name(FilePath, DirPath),
    (   exists_directory(DirPath)
    ->  true
    ;   catch(make_directory_path(DirPath), Error, (
            format(string(ErrorMsg), "Warning: Could not create directory ~w: ~w", [DirPath, Error]),
            yield(log>ErrorMsg),
            fail
        ))
    ).


  try_parse_file(Filename) :-
    open(Filename, read, Stream),
    read_term(Stream, Term, []),
    close(Stream),
    !.



%TODO reify
foldl(Goal, List, V0, V) :-
    foldl_(List, Goal, V0, V).

foldl_([], _, V, V).
foldl_([H|T], Goal, V0, V) :-
    call(Goal, H, V0, V1),
    foldl_(T, Goal, V1, V).


foldl(Goal, List1, List2, V0, V) :-
    foldl_(List1, List2, Goal, V0, V).

foldl_([], [], _, V, V).
foldl_([H1|T1], [H2|T2], Goal, V0, V) :-
    call(Goal, H1, H2, V0, V1),
    foldl_(T1, T2, Goal, V1, V).


foldl(Goal, List1, List2, List3, V0, V) :-
    foldl_(List1, List2, List3, Goal, V0, V).

foldl_([], [], [], _, V, V).
foldl_([H1|T1], [H2|T2], [H3|T3], Goal, V0, V) :-
    call(Goal, H1, H2, H3, V0, V1),
    foldl_(T1, T2, T3, Goal, V1, V).


foldl(Goal, List1, List2, List3, List4, V0, V) :-
    foldl_(List1, List2, List3, List4, Goal, V0, V).

foldl_([], [], [], [], _, V, V).
foldl_([H1|T1], [H2|T2], [H3|T3], [H4|T4], Goal, V0, V) :-
    call(Goal, H1, H2, H3, H4, V0, V1),
    foldl_(T1, T2, T3, T4, Goal, V1, V).