// Isolated helper service so the frontend can learn the current user's roles
// (used to show/hide coordinator-only UI). Added by the frontend team for
// feature 8 role gating — flagged for backend review (see CLAUDE.md).
@requires: 'authenticated-user'
service UserService @(path: '/user') {

    function whoami() returns {
        id    : String;
        roles : array of String;
    };
}
