const posts = [
  {
    id: '1'
  }
];

module.exports = {
  Query: {
    // eslint-disable-next-line no-unused-vars
    posts: async (parent, args, context, info) => { return posts;},
    // eslint-disable-next-line no-unused-vars
    post: async (parent, args, context, info) => { return posts[0];},
  },
  Post: {
    // eslint-disable-next-line no-unused-vars
    comments: async (parent, args, context, info) => {},
  },
};

