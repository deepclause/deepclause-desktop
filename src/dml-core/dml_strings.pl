:- module(dml_strings,
          [ dml_function_expansion/3,
            read_expand_clause/3,
            expand_term/2,
            expand_plan/2,
            interpolate_and_call/3,
            interpolate_string/3
          ]).
:- use_module(library(lists), [append/3]).
:- use_module(library(apply), [exclude/3]).
:- use_module(library(dcg/basics), [prolog_var_name//1, string//1]).
:- use_module(library(error), [type_error/2]).
:- use_module(cmdline).
:- use_module(library(clpfd)).

:- dynamic dml_function_expansion/3.

%%	Template(+Vars:pairs, -Formats:list, -Args:list)//
%
%   Parse a list of codes as if it were an interpolated string. Formats
%   is a list of atoms that can be joined together to
%   create the first argument of format/2. Args are values for the
%   second.
template(Vars, [Static,F|Formats], [Arg|Args]) -->
    string(Codes),

    variable(VarName),
    { 
        writeln(variable(VarName)),
        memberchk(VarName=Arg, Vars),
        F = '~w'
    },
    { atom_codes(Static, Codes) },
    template(Vars, Formats, Args).


template(Vars, [Static,F|Formats], [Arg|Args]) -->
    string(Codes),
    tools(VarName),
    { 
        writeln(tools(VarName)),
        cmdline:get_tools_description(Tools),
        writeln(Tools),
        F = '~w',
        Arg = Tools
    },
    { atom_codes(Static, Codes) },
    template(Vars, Formats, Args).


template(Vars, [Static,F|Formats], [Arg|Args]) -->
    string(Codes),
    dmls(VarName),
    { 
        cmdline:get_dml_files_description(Dmls),
        F = '~w', 
        Arg = Dmls
    },
    { atom_codes(Static, Codes) },
    template(Vars, Formats, Args).


template(_, [Format], []) -->
    string(Codes),
    { atom_codes(Format, Codes) }.



template_const(Vars, [Static,F|Formats], [Arg|Args]) -->
    string(Codes),

    variable(VarName),
    { 
        writeln(variable(VarName)),
        memberchk(VarName=Arg, Vars),
        F = '~w'
    },
    { atom_codes(Static, Codes) },
    template(Vars, Formats, Args).


template_const(Vars, [Static,F|Formats], [Arg|Args]) -->
    string(Codes),
    tools(VarName),
    { 
        writeln(tools(VarName)),
        cmdline:get_tools_description(Tools),
        writeln(Tools),
        F = Tools %'~w',
        %Arg = Tools % '~w'
    },
    { atom_codes(Static, Codes) },
    template(Vars, Formats, Args).


template_const(Vars, [Static,F|Formats], [Arg|Args]) -->
    string(Codes),
    dmls(VarName),
    { 
        cmdline:get_dml_files_description(Dmls),
        F = '~w', 
        Arg = Dmls
    },
    { atom_codes(Static, Codes) },
    template(Vars, Formats, Args).


template_const(_, [Format], []) -->
    string(Codes),
    { atom_codes(Format, Codes) }.


%%	variable(-VarName:atom)//
%
%	Parse a $-prefixed variable name.  Like `$Message`.
%   For now this is a thin wrapper around prolog_var_name//1 but may
%   eventuall grow to support other kinds of variables so I want the
%   details abstracted away.

variable(VarName) -->
    "{",
    prolog_var_name(VarName),
    "}".


tools(VarName) -->
    "{tools}".

dmls(VarName) -->
    "{dmls}".


% true if the module whose terms are being read has specifically
% requested string interpolation.
wants_interpolation :- true.


%%	textual(-Type:atom, +Text, -Codes)
%
%	True if Text is of type Type and representable as Codes.
textual(_,Var,_) :-
    var(Var),
    !,
    fail.
textual(atom, Atom, Codes) :-
    atom(Atom),
    !,
    atom_codes(Atom,Codes).
textual(Type, Text, Codes) :-
    is_list(Text),
    !,
    Text = [H|_],  % empty lists are not text for our purposes
    ( atom(H) ->
        Type = chars,
        catch(atom_chars(Atom,Text),_,fail),
        atom_codes(Atom,Codes)
    ; integer(H) ->
        Type = codes,
        Codes = Text
    ).  % fail on all other lists
textual(string, String, Codes) :-
    string(String),
    string_to_list(String,Codes).


%%	build_text(?Output, ?Formats:list, ?Args:list)
%
%   Like format/3 but dynamically chooses tilde sequences to match the
%   values in Args.
build_text(Output, Formats0, Args) :-
    instantiate_formats(Formats0, Args, Formats),
    atomic_list_concat(Formats, Format),
    format(Output, Format, Args).


% choose format tilde sequences for a list of values
instantiate_formats([], _, []).
instantiate_formats([Static|Formats0],Args,[Static|Formats]) :-
    atom(Static),
    !,
    instantiate_formats(Formats0,Args,Formats).
instantiate_formats([Var|Formats0],[Arg|Args],[Format|Formats]) :-
    var(Var),
    !,
    %preferred_tilde(Arg,Format),
    Format = '~w',
    instantiate_formats(Formats0,Args,Formats).
instantiate_formats([X|_],_,[_|_]) :-
    type_error(atom_or_var,X).


% Which format/2 tilde sequence does a value prefer?
preferred_tilde(X,'~s') :-
    textual(Type, X, _),
    ( Type = codes; Type = chars; Type = string ),
    !.
preferred_tilde(_,'~p').



dml_function_expansion(Vars, Term,Replacement,Guard) :-
    wants_interpolation,
    % Vars \== [],  % need variables to interpolate
    % is this a string in need of interpolation?
    textual(Type, Term, TextCodes),
    phrase(template(Vars, Formats, Args), TextCodes),
    Args \== [],  % no args means no interpolation

    atomic_list_concat(Formats, FString),
    % yup, so perform the expansion
    Output =.. [Type, Replacement],
    Guard = format(Output, FString, Args).


dml_string_constant_expansion(String, Replacement) :-
    textual(Type, String, TextCodes),
    writeln("1"),
    phrase(template_const([], Formats, Args), TextCodes),
    writeln(formats(Formats)),writeln(args(Args) ),
    Args \== [],  % no args means no interpolation
    atomic_list_concat(Formats, Replacement),
    writeln(dml_string_constant_expansion(String, Replacement)).

dml_string_constant_expansion(String, String).


expand_arglist(Vars, [], [], []).
expand_arglist(Vars, [H0|T0], [H|T], [Guard|Guards]) :-  % leaf
    nonvar(H0),
    string(H0),
    dml_function_expansion(Vars, H0, Replacement, Guard),
    H = Replacement,
    expand_arglist(Vars, T0, T, Guards),
    !.

expand_arglist(Vars, [H0|T0], [H|T], Guards) :-          % subtree
    nonvar(H0),
    H0 =.. [Functor|Args0],
    %writeln(functor(H0)),
    Functor \== '@',
    expand_arglist(Vars, Args0, Args, NestedGuards),
    H =.. [Functor|Args],
    expand_arglist(Vars, T0, T, TailGuards),
    append(NestedGuards, TailGuards, Guards),
    !.

expand_arglist(Vars, [H0|T0], [H0|T], Guards) :-
    var(H0),
    expand_arglist(Vars, T0, T, Guards).

%%	xfy_list(?Op:atom, ?Term, ?List) is det.
%
%	True if List joined together with xfy operator Op gives Term.
%	Usable in all directions.  For example,
%
%	==
%	?- xfy_list(',', (a,b,c), L).
%	L = [a, b, c].
%	==
xfy_list(Op, Term, [Left|List]) :-
    Term =.. [Op, Left, Right],
    xfy_list(Op, Right, List),
    !.
xfy_list(_, Term, [Term]).

%%	control(+Term) is semidet.
%
%	True if Term is a control structure such as =,=, =;=, etc.
control((_,_)).
control((_;_)).
control((_->_)).
control((_*->_)).
control(\+(_)).
control(A:-B).


expand_(Vars, T0, T) :-
    var(T0),
    !,
    T = T0.
expand_(Vars, [], []) :-
    !.
expand_(Vars, [H0|T0], [H|T]) :-
    !,
    expand_(Vars, H0, H),
    expand_list_(Vars, T0, T).
expand_(Vars, T0, T) :-
    \+ var(T0),
    \+ control(T0), 
    T0 \= [HH|TT], % goal_expansion/2 already descends into these
    T0 =.. [Functor|Args],

    %writeln(functor2(Functor)),
    Functor \== '@',  % dont expand @-terms
    
    % Check if this is a meta-predicate that needs special handling
    (   is_meta_predicate(Functor, Args)
    ->  expand_meta_predicate(Vars, Functor, Args, T)
    ;   % Normal predicate expansion
        expand_arglist(Vars, Args, NewArgs, Preconditions),
        T1 =.. [Functor|NewArgs],
        % remove guards that are always true
        exclude(==(true), Preconditions, NoTrues),
        (   xfy_list(',', Guard, NoTrues)
        ->  T = (Guard, T1)
        ;   T = T1   % empty guard clause
        )
    ).

expand_(Vars, T0, T) :-
    \+ var(T0),
    \+ control(T0), 
    T0 \= [HH|TT], % goal_expansion/2 already descends into these
    T0 =.. [Functor|Args],
    Functor == '@',
    T = T0.

expand_(Vars, T0, T) :-
 \+ var(T0), 
    T0 = (A,B),
    expand_(Vars, A, A0),
    expand_(Vars, B, B0),
    T = (A0,B0).

expand_(Vars, T0, T) :-
\+ var(T0), 
    T0 = (A;B),
    expand_(Vars, A, A0),
    expand_(Vars, B, B0),
    T = (A0;B0).

expand_(Vars, T0, T) :-
\+ var(T0), 
    T0 = (A->B),
    expand_(Vars, A, A0),
    expand_(Vars, B, B0),
    T = (A0->B0).

expand_(Vars, T0, T) :-
\+ var(T0), 
    T0 = \+(A),
    expand_(Vars, A, A0),
    T = \+(A0).

expand_(Vars, T0, T) :-
\+ var(T0), 
    T0 = (A:-B),
    expand_(Vars, B, B0),
    T = (A :- B0).

%Choice point??
expand_list_(Vars, Tail, Tail) :-
    var(Tail),
    !.
expand_list_(Vars, [], []) :-
    !.
expand_list_(Vars, [H0|T0], [H|T]) :-
    expand_(Vars, H0, H),
    expand_list_(Vars, T0, T).

expand_plan(T0Str, T) :-
    read_term_from_atom(T0Str, T0, [variable_names(Vars)]),
    T0=[HH|TT], % ensure it is a list
    expand_list_(Vars, T0, T).

%expand_plan(T0Str, T) :-
 %   read_term_from_atom(T0Str, TT0, [variable_names(Vars)]),
  %  TT0=([HH|TT], % ensure it is a list
   % expand_list_(Vars, [HH|TT], TTT),
   % T=(TTT).

expand_plan(T0Str, T) :-
    read_term_from_atom(T0Str, TT0, [variable_names(Vars)]),
    TT0 \= [HH|TT],
    %TT0 \= ([HH|TT]),
    expand_(Vars, TT0, T).


expand_term(T0Str, T) :-
    read_term_from_atom(T0Str, T0, [variable_names(Vars)]),
    expand_(Vars, T0, T), !.

read_expand_clause(Stream, T, Bindings) :-
    read_clause(Stream, T0, [variable_names(Bindings),syntax_errors(error)]),
    
    (T0 = (A-->B) ->
        dcg_translate_rule(T0, DCG),
        writeln("DCG:"),
        writeln(DCG),
        T = DCG,
        DCG = (AA :- BB),
        %AA =.. [:, Module, Head],
        %writeln(dcg(Module,Head)),
        AA =.. [HeadHead|Rest],
        writeln(dcg2(HeadHead,Rest)),
        writeln(assertz(plogchain:is_user_rule(_, (HeadHead)))),
        assertz(plogchain:is_user_rule(_, (HeadHead)))
    ;
        system:expand_term(T0,TT0),
        writeln("Before expansion:"),
        writeln(T0),
        writeln("After system expansion:"),
        writeln(TT0),
        expand_(Bindings, TT0, T)

    ).

    %system:expand_term(T0,TT0),
    %TT0 = T0,
    
% Meta-predicate detection and handling
is_meta_predicate(maplist, [_|_]).
is_meta_predicate(include, [_, _, _]).
is_meta_predicate(exclude, [_, _, _]).
is_meta_predicate(findall, [_, _, _]).
is_meta_predicate(forall, [_, _]).
is_meta_predicate(once, [_]).
is_meta_predicate(call, [_|_]).
% Add more meta-predicates as needed

% Special expansion for meta-predicates
expand_meta_predicate(Vars, Functor, Args, T) :-
    Functor = maplist,
    Args = [Goal, List1|RestArgs],
    !,
    expand_meta_goal(Vars, Goal, ExpandedGoal),
    expand_arglist(Vars, [List1|RestArgs], [NewList1|NewRestArgs], Preconditions),
    T1 =.. [Functor, ExpandedGoal, NewList1|NewRestArgs],
    exclude(==(true), Preconditions, NoTrues),
    (   xfy_list(',', Guard, NoTrues)
    ->  T = (Guard, T1)
    ;   T = T1
    ).

expand_meta_predicate(Vars, Functor, Args, T) :-
    Functor = include,
    Args = [Goal, List, Result],
    !,
    expand_meta_goal(Vars, Goal, ExpandedGoal),
    expand_arglist(Vars, [List, Result], [NewList, NewResult], Preconditions),
    T1 =.. [Functor, ExpandedGoal, NewList, NewResult],
    exclude(==(true), Preconditions, NoTrues),
    (   xfy_list(',', Guard, NoTrues)
    ->  T = (Guard, T1)
    ;   T = T1
    ).

expand_meta_predicate(Vars, Functor, Args, T) :-
    Functor = exclude,
    Args = [Goal, List, Result],
    !,
    expand_meta_goal(Vars, Goal, ExpandedGoal),
    expand_arglist(Vars, [List, Result], [NewList, NewResult], Preconditions),
    T1 =.. [Functor, ExpandedGoal, NewList, NewResult],
    exclude(==(true), Preconditions, NoTrues),
    (   xfy_list(',', Guard, NoTrues)
    ->  T = (Guard, T1)
    ;   T = T1
    ).

expand_meta_predicate(Vars, Functor, Args, T) :-
    Functor = findall,
    Args = [Template, Goal, Result],
    !,
    expand_meta_goal(Vars, Goal, ExpandedGoal),
    expand_arglist(Vars, [Template, Result], [NewTemplate, NewResult], Preconditions),
    T1 =.. [Functor, NewTemplate, ExpandedGoal, NewResult],
    exclude(==(true), Preconditions, NoTrues),
    (   xfy_list(',', Guard, NoTrues)
    ->  T = (Guard, T1)
    ;   T = T1
    ).

expand_meta_predicate(Vars, Functor, Args, T) :-
    % Default case for other meta-predicates
    expand_arglist(Vars, Args, NewArgs, Preconditions),
    T1 =.. [Functor|NewArgs],
    exclude(==(true), Preconditions, NoTrues),
    (   xfy_list(',', Guard, NoTrues)
    ->  T = (Guard, T1)
    ;   T = T1
    ).

% Expand goals that will be called by meta-predicates
expand_meta_goal(Vars, Goal, ExpandedGoal) :-
    expand_(Vars, Goal, ExpandedGoal).

% Special argument expansion for meta-goals (immediate string interpolation)
expand_meta_goal_args(Vars, [], [], []).

expand_meta_goal_args(Vars, [H0|T0], [H|T], [Guard|Guards]) :-
    nonvar(H0),
    string(H0),
    dml_function_expansion(Vars, H0, Replacement, Guard),
    !,
    % For meta-goals, we want to perform interpolation immediately
    H = Replacement,
    expand_meta_goal_args(Vars, T0, T, Guards).

expand_meta_goal_args(Vars, [H0|T0], [H|T], Guards) :-
    nonvar(H0),
    H0 =.. [Functor|Args0],
    expand_meta_goal_args(Vars, Args0, Args, NestedGuards),
    H =.. [Functor|Args],
    expand_meta_goal_args(Vars, T0, T, TailGuards),
    append(NestedGuards, TailGuards, Guards),
    !.

expand_meta_goal_args(Vars, [H0|T0], [H0|T], Guards) :-
    expand_meta_goal_args(Vars, T0, T, Guards).

% Alternative approach: Use a special interpolation predicate
% This can be used as: maplist(interpolate_and_call("Hello {Name}"), Names)

interpolate_and_call(Template, Vars, Result) :-
    (   string(Template)
    ->  interpolate_string(Template, Vars, Result)
    ;   Result = Template
    ).

interpolate_string(Template, Vars, Result) :-
    string_codes(Template, Codes),
    (   phrase(template(Vars, Formats, Args), Codes)
    ->  atomic_list_concat(Formats, Format),
        format(string(Result), Format, Args)
    ;   Result = Template
    ).
    (   string(Template)
    ->  interpolate_string(Template, Vars, Result)
    ;   Result = Template
    ).

interpolate_string(Template, Vars, Result) :-
    string_codes(Template, Codes),
    (   phrase(template(Vars, Formats, Args), Codes)
    ->  atomic_list_concat(Formats, Format),
        format(string(Result), Format, Args)
    ;   Result = Template
    ).
