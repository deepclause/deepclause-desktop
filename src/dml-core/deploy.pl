:- module(deploy, []).

:- style_check(-singleton).
:- use_module(library(main)).
:- use_module(library(readutil)).
:- use_module(cmdline).
:- initialization(main, main).

main(Argv) :-
    consult('mcp_config.pl'),
    findall(Config, mcp(_, Config), MCPConfigs),
    py_call(bridge:'init'(MCPConfigs), _),
    retractall(mcp(_, _)),
    py_call('agent':main()).

